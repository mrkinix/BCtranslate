import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

const CONFIG_FILE = '.bctranslaterc.json';

export function getConfigPath(cwd = process.cwd()) {
  return join(cwd, CONFIG_FILE);
}

export function loadConfig(cwd = process.cwd()) {
  const configPath = getConfigPath(cwd);
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveConfig(config, cwd = process.cwd()) {
  const configPath = getConfigPath(cwd);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}

export function configFileName() {
  return CONFIG_FILE;
}
