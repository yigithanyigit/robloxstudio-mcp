local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local State = require(script.Parent.State)
local Utils = require(script.Parent.Utils)
local UI = require(script.Parent.UI)
local QueryHandlers = require(script.Parent.QueryHandlers)
local PropertyHandlers = require(script.Parent.PropertyHandlers)
local InstanceHandlers = require(script.Parent.InstanceHandlers)
local ScriptHandlers = require(script.Parent.ScriptHandlers)
local MetadataHandlers = require(script.Parent.MetadataHandlers)

local pluginState = State.pluginState

local Communication = {}

-- Route map: endpoint -> handler function
local routeMap = {
	-- Query handlers
	["/api/file-tree"] = QueryHandlers.getFileTree,
	["/api/search-files"] = QueryHandlers.searchFiles,
	["/api/place-info"] = QueryHandlers.getPlaceInfo,
	["/api/services"] = QueryHandlers.getServices,
	["/api/search-objects"] = QueryHandlers.searchObjects,
	["/api/instance-properties"] = QueryHandlers.getInstanceProperties,
	["/api/instance-children"] = QueryHandlers.getInstanceChildren,
	["/api/search-by-property"] = QueryHandlers.searchByProperty,
	["/api/class-info"] = QueryHandlers.getClassInfo,
	["/api/project-structure"] = QueryHandlers.getProjectStructure,
	-- Property handlers
	["/api/set-property"] = PropertyHandlers.setProperty,
	["/api/mass-set-property"] = PropertyHandlers.massSetProperty,
	["/api/mass-get-property"] = PropertyHandlers.massGetProperty,
	["/api/set-calculated-property"] = PropertyHandlers.setCalculatedProperty,
	["/api/set-relative-property"] = PropertyHandlers.setRelativeProperty,
	-- Instance handlers
	["/api/create-object"] = InstanceHandlers.createObject,
	["/api/mass-create-objects"] = InstanceHandlers.massCreateObjects,
	["/api/mass-create-objects-with-properties"] = InstanceHandlers.massCreateObjectsWithProperties,
	["/api/delete-object"] = InstanceHandlers.deleteObject,
	["/api/smart-duplicate"] = InstanceHandlers.smartDuplicate,
	["/api/mass-duplicate"] = InstanceHandlers.massDuplicate,
	-- Script handlers
	["/api/get-script-source"] = ScriptHandlers.getScriptSource,
	["/api/set-script-source"] = ScriptHandlers.setScriptSource,
	["/api/edit-script-lines"] = ScriptHandlers.editScriptLines,
	["/api/insert-script-lines"] = ScriptHandlers.insertScriptLines,
	["/api/delete-script-lines"] = ScriptHandlers.deleteScriptLines,
	-- Metadata handlers
	["/api/get-attribute"] = MetadataHandlers.getAttribute,
	["/api/set-attribute"] = MetadataHandlers.setAttribute,
	["/api/get-attributes"] = MetadataHandlers.getAttributes,
	["/api/delete-attribute"] = MetadataHandlers.deleteAttribute,
	["/api/get-tags"] = MetadataHandlers.getTags,
	["/api/add-tag"] = MetadataHandlers.addTag,
	["/api/remove-tag"] = MetadataHandlers.removeTag,
	["/api/get-tagged"] = MetadataHandlers.getTagged,
	["/api/get-selection"] = MetadataHandlers.getSelection,
	["/api/execute-luau"] = MetadataHandlers.executeLuau,
}

local function processRequest(request)
	local endpoint = request.endpoint
	local data = request.data or {}

	local handler = routeMap[endpoint]
	if handler then
		return handler(data)
	else
		return { error = "Unknown endpoint: " .. tostring(endpoint) }
	end
end

local function sendResponse(requestId, responseData)
	pcall(function()
		HttpService:RequestAsync({
			Url = pluginState.serverUrl .. "/response",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
			},
			Body = HttpService:JSONEncode({
				requestId = requestId,
				response = responseData,
			}),
		})
	end)
end

local function pollForRequests()
	if not pluginState.isActive then
		return
	end

	-- Prevent concurrent polling which can duplicate connections
	if pluginState.isPolling then
		return
	end

	pluginState.isPolling = true

	local success, result = pcall(function()
		return HttpService:RequestAsync({
			Url = pluginState.serverUrl .. "/poll",
			Method = "GET",
			Headers = {
				["Content-Type"] = "application/json",
			},
		})
	end)

	pluginState.isPolling = false

	local el = UI.elements

	if success and (result.Success or result.StatusCode == 503) then
		pluginState.consecutiveFailures = 0
		pluginState.currentRetryDelay = 0.5
		pluginState.lastSuccessfulConnection = tick()

		local data = HttpService:JSONDecode(result.Body)
		local mcpConnected = data.mcpConnected == true
		-- Step indicators: HTTP request succeeded
		pluginState.lastHttpOk = true
		el.step1Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
		el.step1Label.Text = "1. HTTP server reachable (OK)"

		if mcpConnected and not el.statusLabel.Text:find("Connected") then
			el.statusLabel.Text = "Connected"
			el.statusLabel.TextColor3 = Color3.fromRGB(34, 197, 94)
			el.statusIndicator.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
			el.statusPulse.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
			el.statusText.Text = "ONLINE"
			el.detailStatusLabel.Text = "HTTP: OK  MCP: OK"
			el.detailStatusLabel.TextColor3 = Color3.fromRGB(34, 197, 94)
			-- Steps 2/3 OK
			el.step2Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
			el.step2Label.Text = "2. MCP bridge connected (OK)"
			el.step3Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
			el.step3Label.Text = "3. Ready for commands (OK)"
			pluginState.mcpWaitStartTime = nil
			el.troubleshootLabel.Visible = false
			UI.stopPulseAnimation()
		elseif not mcpConnected then
			el.statusLabel.Text = "Waiting for MCP server"
			el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusText.Text = "WAITING"
			el.detailStatusLabel.Text = "HTTP: OK  MCP: ..."
			el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			-- Step 2/3 pending
			el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step2Label.Text = "2. MCP bridge connected (waiting...)"
			el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step3Label.Text = "3. Ready for commands (waiting...)"
			-- Track stuck state where HTTP is OK but MCP isn't
			if not pluginState.mcpWaitStartTime then
				pluginState.mcpWaitStartTime = tick()
			end
			local elapsed = tick() - (pluginState.mcpWaitStartTime or tick())
			el.troubleshootLabel.Visible = elapsed > 8
			UI.startPulseAnimation()
		end

		if data.request and mcpConnected then
			-- Process request in a separate thread to not block polling loop
			task.spawn(function()
				local response = processRequest(data.request)
				sendResponse(data.requestId, response)
			end)
		end
	elseif pluginState.isActive then
		pluginState.consecutiveFailures = pluginState.consecutiveFailures + 1

		if pluginState.consecutiveFailures > 1 then
			pluginState.currentRetryDelay =
				math.min(pluginState.currentRetryDelay * pluginState.retryBackoffMultiplier, pluginState.maxRetryDelay)
		end

		if pluginState.consecutiveFailures >= pluginState.maxFailuresBeforeError then
			el.statusLabel.Text = "Server unavailable"
			el.statusLabel.TextColor3 = Color3.fromRGB(239, 68, 68)
			el.statusIndicator.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
			el.statusPulse.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
			el.statusText.Text = "ERROR"
			el.detailStatusLabel.Text = "HTTP: X  MCP: X"
			el.detailStatusLabel.TextColor3 = Color3.fromRGB(239, 68, 68)
			-- Steps show error
			el.step1Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
			el.step1Label.Text = "1. HTTP server reachable (error)"
			el.step2Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
			el.step2Label.Text = "2. MCP bridge connected (error)"
			el.step3Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68)
			el.step3Label.Text = "3. Ready for commands (error)"
			pluginState.mcpWaitStartTime = nil
			el.troubleshootLabel.Visible = false
			UI.stopPulseAnimation()
		elseif pluginState.consecutiveFailures > 5 then
			local waitTime = math.ceil(pluginState.currentRetryDelay)
			el.statusLabel.Text = "Retrying (" .. waitTime .. "s)"
			el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusText.Text = "RETRY"
			el.detailStatusLabel.Text = "HTTP: ...  MCP: ..."
			el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			-- Steps show retrying
			el.step1Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step1Label.Text = "1. HTTP server reachable (retrying...)"
			el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step2Label.Text = "2. MCP bridge connected (retrying...)"
			el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step3Label.Text = "3. Ready for commands (retrying...)"
			pluginState.mcpWaitStartTime = nil
			el.troubleshootLabel.Visible = false
			UI.startPulseAnimation()
		elseif pluginState.consecutiveFailures > 1 then
			el.statusLabel.Text = "Connecting (attempt " .. pluginState.consecutiveFailures .. ")"
			el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.statusText.Text = "CONNECTING"
			el.detailStatusLabel.Text = "HTTP: ...  MCP: ..."
			el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11)
			-- Steps show connecting
			el.step1Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step1Label.Text = "1. HTTP server reachable (connecting...)"
			el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step2Label.Text = "2. MCP bridge connected (connecting...)"
			el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11)
			el.step3Label.Text = "3. Ready for commands (connecting...)"
			pluginState.mcpWaitStartTime = nil
			el.troubleshootLabel.Visible = false
			UI.startPulseAnimation()
		end
	end
end

function Communication.activatePlugin()
	pluginState.serverUrl = UI.elements.urlInput.Text

	pluginState.isActive = true
	pluginState.consecutiveFailures = 0
	pluginState.currentRetryDelay = 0.5
	UI.elements.screenGui.Enabled = true
	UI.updateUIState()

	pcall(function()
		HttpService:RequestAsync({
			Url = pluginState.serverUrl .. "/ready",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
			},
			Body = HttpService:JSONEncode({
				pluginReady = true,
				timestamp = tick(),
			}),
		})
	end)

	if not pluginState.connection then
		pluginState.connection = RunService.Heartbeat:Connect(function()
			local now = tick()
			local currentInterval = pluginState.consecutiveFailures > 5 and pluginState.currentRetryDelay
				or pluginState.pollInterval
			if now - pluginState.lastPoll > currentInterval then
				pluginState.lastPoll = now
				pollForRequests()
			end
		end)
	end
end

function Communication.deactivatePlugin()
	pluginState.isActive = false
	UI.updateUIState()

	pcall(function()
		HttpService:RequestAsync({
			Url = pluginState.serverUrl .. "/disconnect",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
			},
			Body = HttpService:JSONEncode({
				timestamp = tick(),
			}),
		})
	end)

	if pluginState.connection then
		pluginState.connection:Disconnect()
		pluginState.connection = nil
	end

	pluginState.consecutiveFailures = 0
	pluginState.currentRetryDelay = 0.5
end

function Communication.checkForUpdates()
	task.spawn(function()
		local success, result = pcall(function()
			local response = HttpService:RequestAsync({
				Url = "https://registry.npmjs.org/robloxstudio-mcp/latest",
				Method = "GET",
				Headers = {
					["Accept"] = "application/json",
				},
			})
			return response
		end)

		if success and result.Success then
			local ok, data = pcall(function()
				return HttpService:JSONDecode(result.Body)
			end)

			if ok and data and data.version then
				local latestVersion = data.version
				if Utils.compareVersions(State.CURRENT_VERSION, latestVersion) < 0 then
					UI.elements.updateBannerText.Text = "Update available: v" .. latestVersion
					UI.elements.updateBanner.Visible = true
					UI.elements.contentFrame.Position = UDim2.new(0, 10, 0, 110)
					UI.elements.contentFrame.Size = UDim2.new(1, -20, 1, -120)
				end
			end
		end
	end)
end

return Communication
