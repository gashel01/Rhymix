const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');

const lines = content.split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('  const removeLyricsEntry = React.useCallback('));
// Find the exact end of handleTranscribeSelection 
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('    ]);') && lines[i-1].includes('      buildSegmentsFromText,'));

if (startIdx === -1 || endIdx === -1) {
    console.log("Could not find bounds", startIdx, endIdx);
    process.exit(1);
}

const newLines = [
    ...lines.slice(0, startIdx),
    ...lines.slice(endIdx + 1)
];

fs.writeFileSync('src/studio/StudioPage.js', newLines.join('\n'));
console.log('Cleaned up remaining lyrics functions.');
