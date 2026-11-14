import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function extractChangelogSection(changelogText, version) {
  const lines = changelogText.replace(/\r\n/g, '\n').split('\n');
  const headerPrefix = `## [${version}]`;
  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(headerPrefix)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) return '';

  const sectionLines = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) break;
    sectionLines.push(lines[i]);
  }
  return sectionLines.join('\n').trim();
}

export function generateReleaseNotes({ tag, assetPath, changelogPath = path.join(ROOT, 'CHANGELOG.md') }) {
  const normalizedTag = tag.startsWith('v') ? tag : `v${tag}`;
  const version = normalizedTag.slice(1);
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const body = extractChangelogSection(changelog, version) || 'Maintenance and stability updates.';

  const assetName = path.basename(assetPath);
  const assetBytes = fs.readFileSync(assetPath);
  const sha256 = crypto.createHash('sha256').update(assetBytes).digest('hex');

  return [
    'Lightweight Manifest V3 HTML5 `<video>` and `<audio>` speed controller for Google Chrome and Brave Browser.',
    '',
    `## What's New in ${normalizedTag}`,
    '',
    body,
    '',
    '## Quick Install (Chrome & Brave)',
    `1. Download \`${assetName}\` below and extract it.`,
    '2. Open `chrome://extensions` or `brave://extensions`.',
    '3. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder (containing `manifest.json`).',
    '',
    '## Release Checksum',
    `- **Asset:** \`${assetName}\` (\`${assetBytes.length.toLocaleString('en-US')} bytes\`)`,
    `- **SHA-256:** \`${sha256}\``,
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, assetPath, outPath] = process.argv.slice(2);
  if (!tag || !assetPath) {
    console.error('Usage: node scripts/generate-release-notes.mjs <tag> <assetPath> [outputPath]');
    process.exit(1);
  }
  const notes = generateReleaseNotes({ tag, assetPath });
  if (outPath) {
    fs.writeFileSync(outPath, notes, 'utf8');
  } else {
    process.stdout.write(notes);
  }
}
