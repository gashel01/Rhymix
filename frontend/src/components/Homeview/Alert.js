import React from "react";
import IconBtn from "./IconBtn";
import CloseIcon from "@mui/icons-material/Close";
export const Alert = ({ kind = "error", children, onClose, t }) => {
    const isErr = kind === "error";
   
    return (
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${t.hairline}`,
          background: isErr ? t.dangerWash : t.primaryWash,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          color: t.text,
          fontWeight: 800,
        }}
      >
        <div style={{ color: isErr ? t.danger : t.primary }}>{children}</div>
        {onClose && (
          <IconBtn
          t={t}
            onClick={onClose}
            title="Dismiss"
            style={{ width: 34, height: 34, boxShadow: "none" }}
          >
            <CloseIcon style={{ fontSize: 18 }} />
          </IconBtn>
        )}
      </div>
    );
  };
  export default Alert;