const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');

const lines = content.split(/\r?\n/);

const startIdx1 = lines.findIndex(l => l.includes('const lyricsMap = state.metadata?.lyricsReplacement || {};'));
const endIdx1 = lines.findIndex(l => l.includes('buildSegmentsFromText,'));
// handleTranscribeSelection ends at endIdx1 + 2 (the `]);` line)

const startIdx2 = lines.findIndex(l => l.includes('const handleResynthesizeSelection = React.useCallback(async (override = null) => {'));
const endIdx2 = lines.findIndex(l => l.includes('[state.project?.id, lyricsSelection, selectionLyricsEntry, handleStartJob, detectLyricsLanguage]);'));

if (startIdx1 === -1 || endIdx1 === -1 || startIdx2 === -1 || endIdx2 === -1) {
  console.log('Error: Could not find lyrics logic bounds');
  process.exit(1);
}

const hookCall = `  const {
    lyricsMap,
    lyricsSelection,
    selectionLyricsEntry,
    buildSegmentsFromText,
    updateLyricsText,
    removeLyricsEntry,
    restoreLyricsEntry,
    handleTranscribeSelection,
    handleResynthesizeSelection,
  } = useLyricsActions({ handleStartJob });`;

const newLines = [
  ...lines.slice(0, startIdx1),
  ...lines.slice(endIdx1 + 3, startIdx2),
  hookCall,
  ...lines.slice(endIdx2 + 1)
];

// We need to add import for useLyricsActions at the top
const finalContent = newLines.join('\n').replace(
  'import { useStudioPlayback } from \'./hooks/useStudioPlayback\';',
  'import { useStudioPlayback } from \'./hooks/useStudioPlayback\';\nimport { useLyricsActions } from \'./hooks/useLyricsActions\';'
);

fs.writeFileSync('src/studio/StudioPage.js', finalContent);
console.log('Successfully replaced lyrics logic.');
