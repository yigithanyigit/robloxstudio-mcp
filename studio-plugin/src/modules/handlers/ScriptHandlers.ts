import Utils from "../Utils";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const ScriptEditorService = game.GetService("ScriptEditorService");

const { getInstancePath, getInstanceByPath, readScriptSource, splitLines, joinLines } = Utils;

function normalizeEscapes(s: string): string {
	let result = s;
	result = result.gsub("\\n", "\n")[0];
	result = result.gsub("\\t", "\t")[0];
	result = result.gsub("\\r", "\r")[0];
	result = result.gsub("\\\\", "\\")[0];
	return result;
}

function getScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number | undefined;
	const endLine = requestData.endLine as number | undefined;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const fullSource = readScriptSource(instance);
		const [lines, hasTrailingNewline] = splitLines(fullSource);
		const totalLineCount = lines.size();

		let sourceToReturn = fullSource;
		let returnedStartLine = 1;
		let returnedEndLine = totalLineCount;

		if (startLine !== undefined || endLine !== undefined) {
			const actualStartLine = math.max(1, startLine ?? 1);
			const actualEndLine = math.min(lines.size(), endLine ?? lines.size());

			const selectedLines: string[] = [];
			for (let i = actualStartLine; i <= actualEndLine; i++) {
				selectedLines.push(lines[i - 1] ?? "");
			}

			sourceToReturn = selectedLines.join("\n");
			if (hasTrailingNewline && actualEndLine === lines.size() && sourceToReturn.sub(-1) !== "\n") {
				sourceToReturn += "\n";
			}
			returnedStartLine = actualStartLine;
			returnedEndLine = actualEndLine;
		}

		const numberedLines: string[] = [];
		const linesToNumber = startLine !== undefined ? splitLines(sourceToReturn)[0] : lines;
		const lineOffset = returnedStartLine - 1;
		for (let i = 0; i < linesToNumber.size(); i++) {
			numberedLines.push(`${i + 1 + lineOffset}: ${linesToNumber[i]}`);
		}
		const numberedSource = numberedLines.join("\n");

		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			name: instance.Name,
			source: sourceToReturn,
			numberedSource,
			sourceLength: fullSource.size(),
			lineCount: totalLineCount,
			startLine: returnedStartLine,
			endLine: returnedEndLine,
			isPartial: startLine !== undefined || endLine !== undefined,
			truncated: false,
		};

		if (startLine === undefined && endLine === undefined && fullSource.size() > 50000) {
			const truncatedLines: string[] = [];
			const truncatedNumberedLines: string[] = [];
			const maxLines = math.min(1000, lines.size());
			for (let i = 0; i < maxLines; i++) {
				truncatedLines.push(lines[i]);
				truncatedNumberedLines.push(`${i + 1}: ${lines[i]}`);
			}
			resp.source = truncatedLines.join("\n");
			resp.numberedSource = truncatedNumberedLines.join("\n");
			resp.truncated = true;
			resp.endLine = maxLines;
			resp.note = "Script truncated to first 1000 lines. Use startLine/endLine parameters to read specific sections.";
		}

		if (instance.IsA("BaseScript")) {
			resp.enabled = instance.Enabled;
		}
		return resp;
	});

	if (success) {
		return result;
	} else {
		return { error: `Failed to get script source: ${result}` };
	}
}

function setScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newSource = requestData.source as string;

	if (!instancePath || !newSource) return { error: "Instance path and source are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const sourceToSet = normalizeEscapes(newSource);

	const [updateSuccess, updateResult] = pcall(() => {
		const oldSourceLength = readScriptSource(instance).size();

		ScriptEditorService.UpdateSourceAsync(instance, () => sourceToSet);
		ChangeHistoryService.SetWaypoint(`Set script source: ${instance.Name}`);

		return {
			success: true, instancePath,
			oldSourceLength, newSourceLength: sourceToSet.size(),
			method: "UpdateSourceAsync",
			message: "Script source updated successfully (editor-safe)",
		};
	});

	if (updateSuccess) return updateResult;

	const [directSuccess, directResult] = pcall(() => {
		const oldSource = (instance as unknown as { Source: string }).Source;
		(instance as unknown as { Source: string }).Source = sourceToSet;
		ChangeHistoryService.SetWaypoint(`Set script source: ${instance.Name}`);

		return {
			success: true, instancePath,
			oldSourceLength: oldSource.size(), newSourceLength: sourceToSet.size(),
			method: "direct",
			message: "Script source updated successfully (direct assignment)",
		};
	});

	if (directSuccess) return directResult;

	const [replaceSuccess, replaceResult] = pcall(() => {
		const parent = instance.Parent;
		const name = instance.Name;
		const className = instance.ClassName;
		const wasBaseScript = instance.IsA("BaseScript");
		const enabled = wasBaseScript ? instance.Enabled : undefined;

		const newScript = new Instance(className as keyof CreatableInstances) as LuaSourceContainer;
		newScript.Name = name;
		(newScript as unknown as { Source: string }).Source = sourceToSet;
		if (wasBaseScript && enabled !== undefined) {
			(newScript as BaseScript).Enabled = enabled;
		}

		newScript.Parent = parent;
		instance.Destroy();
		ChangeHistoryService.SetWaypoint(`Replace script: ${name}`);

		return {
			success: true,
			instancePath: getInstancePath(newScript),
			method: "replace",
			message: "Script replaced successfully with new source",
		};
	});

	if (replaceSuccess) return replaceResult;
	return {
		error: `Failed to set script source. UpdateSourceAsync failed: ${updateResult}. Direct assignment failed: ${directResult}. Replace method failed: ${replaceResult}`,
	};
}

function editScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;
	let newContent = requestData.newContent as string;

	if (!instancePath || !startLine || !endLine || !newContent) {
		return { error: "Instance path, startLine, endLine, and newContent are required" };
	}

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
		ChangeHistoryService.SetWaypoint(`Edit script lines ${startLine}-${endLine}: ${instance.Name}`);

		return {
			success: true, instancePath,
			editedLines: { startLine, endLine },
			linesRemoved: endLine - startLine + 1,
			linesAdded: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines edited successfully",
		};
	});

	if (success) return result;
	return { error: `Failed to edit script lines: ${result}` };
}

function insertScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const afterLine = (requestData.afterLine as number) ?? 0;
	let newContent = requestData.newContent as string;

	if (!instancePath || !newContent) return { error: "Instance path and newContent are required" };

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (afterLine < 0 || afterLine > totalLines) error(`afterLine out of range (0-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < afterLine; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = afterLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
		ChangeHistoryService.SetWaypoint(`Insert script lines after line ${afterLine}: ${instance.Name}`);

		return {
			success: true, instancePath,
			insertedAfterLine: afterLine,
			linesInserted: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines inserted successfully",
		};
	});

	if (success) return result;
	return { error: `Failed to insert script lines: ${result}` };
}

function deleteScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;

	if (!instancePath || !startLine || !endLine) {
		return { error: "Instance path, startLine, and endLine are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const resultLines: string[] = [];
		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
		ChangeHistoryService.SetWaypoint(`Delete script lines ${startLine}-${endLine}: ${instance.Name}`);

		return {
			success: true, instancePath,
			deletedLines: { startLine, endLine },
			linesDeleted: endLine - startLine + 1,
			newLineCount: resultLines.size(),
			message: "Script lines deleted successfully",
		};
	});

	if (success) return result;
	return { error: `Failed to delete script lines: ${result}` };
}

function validateScript(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string | undefined;
	const rawSource = requestData.source as string | undefined;

	let source: string;
	if (rawSource !== undefined) {
		source = rawSource;
	} else if (instancePath) {
		const instance = getInstanceByPath(instancePath);
		if (!instance) return { error: `Instance not found: ${instancePath}` };
		if (!instance.IsA("LuaSourceContainer")) {
			return { error: `Instance is not a script: ${instance.ClassName}` };
		}
		source = readScriptSource(instance);
	} else {
		return { error: "Either instancePath or source is required" };
	}

	const [success, err] = pcall(() => {
		(loadstring as (s: string) => unknown)(source);
	});

	if (success) {
		return { valid: true, errors: [] };
	}

	const errStr = tostring(err);
	const errors: { line: number | undefined; message: string }[] = [];
	const [lineStr, msg] = errStr.match(":(%d+):%s*(.+)$") as LuaTuple<[string?, string?]>;
	if (lineStr && msg) {
		errors.push({ line: tonumber(lineStr), message: msg });
	} else {
		errors.push({ line: undefined, message: errStr });
	}

	return { valid: false, errors };
}

function getScriptDeps(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script: ${instance.ClassName}` };
	}

	const myPath = getInstancePath(instance);
	const myName = instance.Name;

	const [success, result] = pcall(() => {
		const source = readScriptSource(instance!);
		const requires: { path: string; variable: string }[] = [];

		for (const [variable, reqPath] of source.gmatch("local%s+(%w+)%s*=%s*require%(([^%)]+)%)")) {
			requires.push({ path: reqPath as string, variable: variable as string });
		}

		const requiredBy: { path: string; variable: string }[] = [];

		function scanDescendants(root: Instance) {
			for (const desc of root.GetDescendants()) {
				if (desc.IsA("LuaSourceContainer") && desc !== instance) {
					const [ok, descSource] = pcall(() => readScriptSource(desc as LuaSourceContainer));
					if (ok && descSource) {
						for (const [variable, reqPath] of (descSource as string).gmatch("local%s+(%w+)%s*=%s*require%(([^%)]+)%)")) {
							const rp = reqPath as string;
							if (rp.find(myName)[0] || rp.find(myPath)[0]) {
								requiredBy.push({
									path: getInstancePath(desc),
									variable: variable as string,
								});
							}
						}
					}
				}
			}
		}

		scanDescendants(game);

		return { instancePath: myPath, requires, requiredBy };
	});

	if (success) return result;
	return { error: `Failed to get script dependencies: ${result}` };
}

function getModuleInfo(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("ModuleScript")) {
		return { error: `Instance is not a ModuleScript: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const source = readScriptSource(instance);
		const [lines] = splitLines(source);

		const exportedKeys: string[] = [];
		for (const [key] of source.gmatch("([%w_]+)%s*=")) {
			exportedKeys.push(key as string);
		}
		for (const [key] of source.gmatch("function%s+[%w_%.]-%.?([%w_]+)%s*%(")) {
			if (!exportedKeys.includes(key as string)) {
				exportedKeys.push(key as string);
			}
		}

		const descriptionLines: string[] = [];
		for (const line of lines) {
			const trimmed = line.match("^%s*%-%-(.*)$") as LuaTuple<[string?]>;
			if (trimmed[0] !== undefined) {
				descriptionLines.push(trimmed[0]);
			} else {
				break;
			}
		}

		const dependencies: { path: string; variable: string }[] = [];
		for (const [variable, reqPath] of source.gmatch("local%s+(%w+)%s*=%s*require%(([^%)]+)%)")) {
			dependencies.push({ path: reqPath as string, variable: variable as string });
		}

		return {
			instancePath: getInstancePath(instance),
			name: instance.Name,
			exports: exportedKeys,
			dependencies,
			description: descriptionLines.size() > 0 ? descriptionLines.join("\n") : undefined,
			lineCount: lines.size(),
		};
	});

	if (success) return result;
	return { error: `Failed to get module info: ${result}` };
}

export = {
	getScriptSource,
	setScriptSource,
	editScriptLines,
	insertScriptLines,
	deleteScriptLines,
	validateScript,
	getScriptDeps,
	getModuleInfo,
};
