import React from "react";

export function MissingDepsModal({ open, onClose, missingDeps, ui }) {
  const { Modal, Btn } = ui;
  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title="Missing Dependencies"
      footer={
        <Btn variant="secondary" onClick={onClose} style={{ height: 40 }}>
          Close
        </Btn>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {missingDeps?.packages?.length > 0 && (
          <div>
            Missing packages: <strong>{missingDeps.packages.join(", ")}</strong>
          </div>
        )}
        {missingDeps?.pip && (
          <div>
            Run this command:
            <div style={{ marginTop: 6 }}>
              <code>{missingDeps.pip}</code>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
