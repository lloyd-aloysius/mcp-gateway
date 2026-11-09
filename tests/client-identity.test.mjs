import assert from 'node:assert/strict';
import test from 'node:test';
import { clientName, clientPreset } from '../src/lib/client-identity.ts';

test('recognizes configured client names and name segments without overmatching', () => {
  for (const [name, preset] of [
    ['Codex', 'codex'], ['mbp-boom-codex', 'codex'], ['CODEX desktop', 'codex'],
    ['Claude Code', 'claude-code'], ['claude-code', 'claude-code'], ['claude_code', 'claude-code'],
    ['OpenClaw', 'openclaw'], ['open-claw-mac', 'openclaw'], ['hermes-agent', 'hermes'], ['Cursor', 'cursor'], ['windsurf-ide', 'windsurf'], ['GitHub Copilot', 'github-copilot'], ['Claude Desktop', 'claude-desktop'],
    ['Antigravity', 'antigravity'], ['work antigravity', 'antigravity'],
    ['custom-agent', 'generic'], ['mycodexproxy', 'generic'], ['claudette', 'generic'],
  ]) assert.equal(clientPreset({ clientId: name }), preset, name);
});

test('configured names override the client ID and blank names fall back safely', () => {
  assert.equal(clientPreset({ clientId: 'codex', label: 'Custom assistant' }), 'generic');
  assert.equal(clientPreset({ clientId: 'agent-1', label: 'Claude Code' }), 'claude-code');
  assert.equal(clientPreset({ clientId: 'codex', label: '  ' }), 'codex');
  assert.equal(clientName({ clientId: 'agent-1', label: ' Codex Mac ' }), 'Codex Mac');
  assert.equal(clientName(null), 'Unknown client');
  assert.equal(clientPreset(null), 'generic');
});

test('explicit logos survive renames, auto restores detection, and unknown values fall back safely', () => {
  assert.equal(clientPreset({ clientId: 'codex', label: 'Work assistant', icon: 'hermes' }), 'hermes');
  assert.equal(clientPreset({ clientId: 'codex', icon: 'generic' }), 'generic');
  assert.equal(clientPreset({ clientId: 'codex', icon: 'terminal' }), 'terminal');
  assert.equal(clientPreset({ clientId: 'codex', icon: 'auto' }), 'codex');
  assert.equal(clientPreset({ clientId: 'codex', icon: 'constructor' }), 'codex');
  assert.equal(clientPreset({ clientId: 'codex', icon: 'https://untrusted.invalid/icon.svg' }), 'codex');
});
