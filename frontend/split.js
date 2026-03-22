const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');
const lines = content.split(/\r?\n/);
const hookLines = ['import { useEffect, useRef } from \'react\';'].concat(lines.slice(19, 861));

const hookContent = hookLines.join('\n').replace('const useStudioPlayback =', 'export const useStudioPlayback =');
fs.mkdirSync('src/studio/hooks', { recursive: true });
fs.writeFileSync('src/studio/hooks/useStudioPlayback.js', hookContent);

const newLines = lines.slice(0, 19)
  .concat(['import { useStudioPlayback } from \'./hooks/useStudioPlayback\';'])
  .concat(lines.slice(861));
fs.writeFileSync('src/studio/StudioPage.js', newLines.join('\n'));
console.log('Split completed successfully.');
