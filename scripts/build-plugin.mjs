#!/usr/bin/env node
/**
 * Build MCPPlugin.rbxmx from the modular plugin source without requiring Rojo.
 * Usage: node scripts/build-plugin.mjs
 *
 * Creates a Script with child ModuleScripts under a "modules" Folder,
 * matching the Argon project structure.
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const pluginDir = join(rootDir, 'studio-plugin');
const sourcePath = join(pluginDir, 'src', 'MCPPlugin.server.luau');
const modulesDir = join(pluginDir, 'src', 'modules');
const outputPath = join(pluginDir, 'MCPPlugin.rbxmx');

function escapeCdata(source) {
  // In XML CDATA, the only forbidden sequence is ]]>. Split so it becomes ]]]]><![CDATA[>
  return source.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

const mainSource = readFileSync(sourcePath, 'utf8');

// Read all module files
const moduleFiles = readdirSync(modulesDir)
  .filter(f => f.endsWith('.luau'))
  .sort();

let moduleItems = '';
let refId = 1;

for (const file of moduleFiles) {
  const moduleName = basename(file, '.luau');
  const moduleSource = readFileSync(join(modulesDir, file), 'utf8');
  refId++;
  moduleItems += `
      <Item class="ModuleScript" referent="${refId}">
        <Properties>
          <string name="Name">${moduleName}</string>
          <string name="Source"><![CDATA[${escapeCdata(moduleSource)}]]></string>
        </Properties>
      </Item>`;
}

const rbxmx = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <Item class="Script" referent="0">
    <Properties>
      <string name="Name">MCPPlugin</string>
      <token name="RunContext">0</token>
      <string name="Source"><![CDATA[${escapeCdata(mainSource)}]]></string>
    </Properties>
    <Item class="Folder" referent="1">
      <Properties>
        <string name="Name">modules</string>
      </Properties>${moduleItems}
    </Item>
  </Item>
</roblox>
`;

writeFileSync(outputPath, rbxmx, 'utf8');
console.log(`Built studio-plugin/MCPPlugin.rbxmx (${moduleFiles.length} modules)`);
