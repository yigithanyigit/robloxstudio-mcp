import { LogService } from "@rbxts/services";

const StudioTestService = game.GetService("StudioTestService");
const ServerScriptService = game.GetService("ServerScriptService");
const ScriptEditorService = game.GetService("ScriptEditorService");

const STOP_SIGNAL = "__MCP_STOP__";

interface OutputEntry {
	message: string;
	messageType: string;
	timestamp: number;
}

let testRunning = false;
let outputBuffer: OutputEntry[] = [];
let logConnection: RBXScriptConnection | undefined;
let testResult: unknown;
let testError: string | undefined;
let stopListenerScript: Script | undefined;

function buildStopListenerSource(): string {
	return `local LogService = game:GetService("LogService")
local StudioTestService = game:GetService("StudioTestService")
LogService.MessageOut:Connect(function(message)
	if message == "${STOP_SIGNAL}" then
		pcall(function() StudioTestService:EndTest("stopped_by_mcp") end)
	end
end)`;
}

function injectStopListener() {
	const listener = new Instance("Script");
	listener.Name = "__MCP_StopListener";
	listener.Parent = ServerScriptService;

	const source = buildStopListenerSource();
	const [seOk] = pcall(() => {
		ScriptEditorService.UpdateSourceAsync(listener, () => source);
	});
	if (!seOk) {
		(listener as unknown as { Source: string }).Source = source;
	}

	stopListenerScript = listener;
}

function cleanupStopListener() {
	if (stopListenerScript) {
		pcall(() => stopListenerScript!.Destroy());
		stopListenerScript = undefined;
	}
}

function startPlaytest(requestData: Record<string, unknown>) {
	const mode = requestData.mode as string | undefined;

	if (mode !== "play" && mode !== "run") {
		return { error: 'mode must be "play" or "run"' };
	}

	if (testRunning) {
		return { error: "A test is already running" };
	}

	testRunning = true;
	outputBuffer = [];
	testResult = undefined;
	testError = undefined;

	cleanupStopListener();

	logConnection = LogService.MessageOut.Connect((message, messageType) => {
		if (message === STOP_SIGNAL) return;
		outputBuffer.push({
			message,
			messageType: messageType.Name,
			timestamp: tick(),
		});
	});

	const [injected, injErr] = pcall(() => injectStopListener());
	if (!injected) {
		warn(`[MCP] Failed to inject stop listener: ${injErr}`);
	}

	task.spawn(() => {
		const [ok, result] = pcall(() => {
			if (mode === "play") {
				return StudioTestService.ExecutePlayModeAsync({});
			}
			return StudioTestService.ExecuteRunModeAsync({});
		});

		if (ok) {
			testResult = result;
		} else {
			testError = tostring(result);
		}

		if (logConnection) {
			logConnection.Disconnect();
			logConnection = undefined;
		}
		testRunning = false;

		cleanupStopListener();
	});

	return { success: true, message: `Playtest started in ${mode} mode` };
}

function stopPlaytest(_requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "No test is currently running" };
	}

	warn(STOP_SIGNAL);

	return {
		success: true,
		output: [...outputBuffer],
		outputCount: outputBuffer.size(),
		message: "Playtest stop signal sent.",
	};
}

function getPlaytestOutput(requestData: Record<string, unknown>) {
	const filter = requestData.filter as string | undefined;
	const since = requestData.since as number | undefined;
	const clearAfter = requestData.clear as boolean | undefined;

	let entries = [...outputBuffer];

	if (since !== undefined) {
		entries = entries.filter((e) => e.timestamp > since);
	}

	if (filter && filter !== "all") {
		const typeMap: Record<string, string> = {
			error: "MessageError",
			warn: "MessageWarning",
			print: "MessageOutput",
		};
		const target = typeMap[filter];
		if (target) {
			entries = entries.filter((e) => e.messageType === target);
		}
	}

	const result = {
		isRunning: testRunning,
		output: entries,
		outputCount: entries.size(),
		testResult: testResult !== undefined ? tostring(testResult) : undefined,
		testError,
	};

	if (clearAfter) {
		outputBuffer = [];
	}

	return result;
}

function getGameState(requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "No playtest is currently running" };
	}

	const query = requestData.query as string | undefined;
	const [success, result] = pcall(() => {
		const state: Record<string, unknown> = { isRunning: true };

		if (!query || query === "players") {
			const Players = game.GetService("Players");
			const playerList: Record<string, unknown>[] = [];
			for (const player of Players.GetPlayers()) {
				const info: Record<string, unknown> = {
					name: player.Name,
					displayName: player.DisplayName,
					userId: player.UserId,
				};
				const character = player.Character;
				if (character) {
					const humanoid = character.FindFirstChildOfClass("Humanoid");
					if (humanoid) {
						info.health = humanoid.Health;
						info.maxHealth = humanoid.MaxHealth;
					}
					const rootPart = character.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
					if (rootPart) {
						info.position = { X: rootPart.Position.X, Y: rootPart.Position.Y, Z: rootPart.Position.Z };
					}
				}
				playerList.push(info);
			}
			state.players = playerList;
		}

		if (!query || query === "camera") {
			const camera = game.GetService("Workspace").CurrentCamera;
			if (camera) {
				const pos = camera.CFrame.Position;
				const look = camera.CFrame.LookVector;
				state.camera = {
					position: { X: pos.X, Y: pos.Y, Z: pos.Z },
					lookVector: { X: look.X, Y: look.Y, Z: look.Z },
					fieldOfView: camera.FieldOfView,
				};
			}
		}

		if (!query || query === "workspace") {
			const workspace = game.GetService("Workspace");
			state.workspace = {
				gravity: workspace.Gravity,
				childCount: workspace.GetChildren().size(),
			};
		}

		return state;
	});

	if (success) return result;
	return { error: `Failed to get game state: ${result}` };
}

function sendGameCommand(requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "No playtest is currently running" };
	}

	const command = requestData.command as string;
	const params = (requestData.params as Record<string, unknown>) ?? {};

	if (!command) return { error: "command is required" };

	const [success, result] = pcall(() => {
		if (command === "move_player") {
			const targetPos = params.targetPosition as Record<string, number>;
			if (!targetPos) error("targetPosition is required for move_player");
			const Players = game.GetService("Players");
			const players = Players.GetPlayers();
			if (players.size() === 0) error("No players in game");
			const player = players[0];
			const character = player.Character;
			if (!character) error("Player has no character");
			const rootPart = character.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
			if (!rootPart) error("Character has no HumanoidRootPart");
			rootPart.CFrame = new CFrame(targetPos.X ?? 0, targetPos.Y ?? 0, targetPos.Z ?? 0);
			return { success: true, result: "Player moved" };
		}

		if (command === "set_camera") {
			const position = params.position as Record<string, number>;
			const lookAt = params.lookAt as Record<string, number>;
			if (!position) error("position is required for set_camera");
			const camera = game.GetService("Workspace").CurrentCamera;
			if (!camera) error("No current camera");
			const posVec = new Vector3(position.X ?? 0, position.Y ?? 0, position.Z ?? 0);
			if (lookAt) {
				const lookVec = new Vector3(lookAt.X ?? 0, lookAt.Y ?? 0, lookAt.Z ?? 0);
				camera.CFrame = CFrame.lookAt(posVec, lookVec);
			} else {
				camera.CFrame = new CFrame(posVec);
			}
			return { success: true, result: "Camera repositioned" };
		}

		if (command === "click_ui") {
			const buttonPath = params.buttonPath as string;
			if (!buttonPath) error("buttonPath is required for click_ui");
			const Players = game.GetService("Players");
			const localPlayer = Players.LocalPlayer;
			if (!localPlayer) error("No LocalPlayer available");
			const playerGui = localPlayer.FindFirstChild("PlayerGui");
			if (!playerGui) error("No PlayerGui found");
			const btn = playerGui.FindFirstChild(buttonPath, true) as GuiButton | undefined;
			if (!btn) error(`UI element not found: ${buttonPath}`);
			const [fireOk] = pcall(() => {
				(btn as unknown as { Activated: { Fire: () => void } }).Activated.Fire();
			});
			if (!fireOk) {
				btn!.SetAttribute("__MCP_Clicked", tick());
			}
			return { success: true, result: `Clicked ${buttonPath}` };
		}

		if (command === "set_property") {
			const instancePath = params.instancePath as string;
			const property = params.property as string;
			const value = params.value;
			if (!instancePath || !property) error("instancePath and property are required");
			const inst = game.FindFirstChild(instancePath, true);
			if (!inst) error(`Instance not found: ${instancePath}`);
			(inst as unknown as Record<string, unknown>)[property] = value;
			return { success: true, result: `Set ${property} on ${instancePath}` };
		}

		error(`Unknown command: ${command}`);
	});

	if (success) return result;
	return { error: `Command failed: ${result}` };
}

export = {
	startPlaytest,
	stopPlaytest,
	getPlaytestOutput,
	getGameState,
	sendGameCommand,
};
