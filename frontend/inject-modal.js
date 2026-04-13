const fs = require('fs');
const content = fs.readFileSync('src/studio/StudioPage.js', 'utf8');

let finalContent = content;

// 1. Add import
if (!finalContent.includes('import ProjectManagerModal')) {
  finalContent = finalContent.replace(
    'import JobToasts from "./components/JobToasts";',
    'import JobToasts from "./components/JobToasts";\nimport ProjectManagerModal from "./components/ProjectManagerModal";'
  );
}

// 2. Add state
if (!finalContent.includes('const [showProjectManager')) {
  finalContent = finalContent.replace(
    'const [loading, setLoading] = useState(true);',
    'const [showProjectManager, setShowProjectManager] = useState(false);\n  const [loading, setLoading] = useState(true);'
  );
}

// 3. Add prop to LibraryPanel
if (finalContent.includes('<LibraryPanel') && !finalContent.includes('onOpenProjectManager=')) {
  finalContent = finalContent.replace(
    'currentTime={state.transport.currentTime}\n                />',
    'currentTime={state.transport.currentTime}\n                  onOpenProjectManager={() => setShowProjectManager(true)}\n                />'
  );
}

// 4. Add ProjectManagerModal at the bottom, just before <JobToasts
if (!finalContent.includes('<ProjectManagerModal')) {
  const modalJSX = 
      '      <ProjectManagerModal\\n' +
      '        open={showProjectManager}\\n' +
      '        onClose={() => setShowProjectManager(false)}\\n' +
      '        assetId={assetId}\\n' +
      '        currentProjectId={state.project?.id}\\n' +
      '        onSwitchProject={(newProjectData) => {\\n' +
      '          actions.setProject(newProjectData);\\n' +
      '        }}\\n' +
      '      />\\n' +
      '      <JobToasts';
  finalContent = finalContent.replace('<JobToasts', modalJSX);
}

fs.writeFileSync('src/studio/StudioPage.js', finalContent);
console.log('Successfully applied StudioPage changes.');
