const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');
const lines = content.split(/\r?\n/);

const startIdx1 = lines.findIndex(l => l.includes('<div className="studio-panel studio-create-panel">'));
const endIdx1 = lines.findIndex((l, idx) => idx > startIdx1 && l.includes('</button>') && lines[idx+1].includes('                  </div>') && lines[idx+2].includes('                </div>'));

const startIdx2 = lines.findIndex(l => l.includes('<div className="studio-panel studio-library-panel">'));
const endIdx2 = lines.findIndex((l, idx) => idx > startIdx2 && l.includes('Project Switcher</button>') && lines[idx+1].includes('                  </div>') && lines[idx+2].includes('                </div>'));

if (startIdx1 === -1 || endIdx1 === -1 || startIdx2 === -1 || endIdx2 === -1) {
  console.log('Error finding components', { startIdx1, endIdx1, startIdx2, endIdx2 });
  process.exit(1);
}

const comp1Call = `                <CreationDashboard
                  createMode={createMode}
                  setCreateMode={setCreateMode}
                  lyrics={lyrics}
                  setLyrics={setLyrics}
                  style={style}
                  setStyle={setStyle}
                  model={model}
                  setModel={setModel}
                  createPrompt={createPrompt}
                  handleStartJob={handleStartJob}
                />`;

const comp2Call = `                <LibraryPanel
                  libraryQuery={libraryQuery}
                  setLibraryQuery={setLibraryQuery}
                  filteredAssets={filteredAssets}
                  lanes={state.lanes}
                  actions={actions}
                  currentTime={state.transport.currentTime}
                />`;

const newLines = [
  ...lines.slice(0, startIdx1),
  comp1Call,
  ...lines.slice(endIdx1 + 3, startIdx2),
  comp2Call,
  ...lines.slice(endIdx2 + 3)
];

const finalContent = newLines.join('\n').replace(
  'import Inspector from "./components/Inspector";',
  'import Inspector from "./components/Inspector";\nimport CreationDashboard from "./components/CreationDashboard";\nimport LibraryPanel from "./components/LibraryPanel";'
);

fs.writeFileSync('src/studio/StudioPage.js', finalContent);
console.log('Successfully replaced components.');
