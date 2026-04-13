const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');

const lines = content.split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('const handleKeyDown = (event) => {')) - 1; 
// 1 line before that is `useEffect(() => {`

const endIdx = lines.findIndex((l, idx) => idx > startIdx && l.includes(' playback,') && lines[idx+1].includes('  ]);')) + 1;

if (startIdx === -2 || endIdx === 0) {
  console.log('Error: Could not find keyboard logic bounds');
  process.exit(1);
}

const effectLines = lines.slice(startIdx, endIdx + 1).join('\n');

const hookContent = `import { useEffect } from "react";
import { useStudioStore } from "../store";

export const useStudioKeyboardShortcuts = (playback) => {
  const { state, actions } = useStudioStore();

${effectLines}
};
`;

fs.writeFileSync('src/studio/hooks/useStudioKeyboardShortcuts.js', hookContent);

const hookCall = `  useStudioKeyboardShortcuts(playback);`;

let newLines = [
  ...lines.slice(0, startIdx),
  hookCall,
  ...lines.slice(endIdx + 1)
];

// Combine import
const finalContent = newLines.join('\n').replace(
  'import { useLyricsActions } from \'./hooks/useLyricsActions\';',
  'import { useLyricsActions } from \'./hooks/useLyricsActions\';\nimport { useStudioKeyboardShortcuts } from \'./hooks/useStudioKeyboardShortcuts\';'
);

fs.writeFileSync('src/studio/StudioPage.js', finalContent);
console.log('Successfully replaced keyboard shortcuts logic.');
