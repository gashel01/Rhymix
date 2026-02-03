import React from "react";
import {Glass} from "./Glass.js"
import {Hairline} from "./Hairline.js"
import IconBtn from "./IconBtn.js"
import {Close as CloseIcon} from "@mui/icons-material"

export const Modal = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 560,
  
  t,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: t.isDark ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.3)",
      }}
    >
      <Glass t={t} style={{ width: "100%", maxWidth, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 950, letterSpacing: -0.3, color: t.text, fontFamily: "DM Sans" }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 13, fontWeight: 300, color: t.subtext, fontFamily: "Rubik" }}>
                {subtitle}
              </div>
            )}
          </div>
          <IconBtn 
            t={t}
            onClick={onClose}
            title="Close"
            style={{ width: 36, height: 36, background: "none", boxShadow: "none" }}
          >
            <CloseIcon t={t} style={{ fontSize: 18 }} />
          </IconBtn>
        </div>

        <Hairline t={t} style={{ margin: "10px 0 12px" }} />
        <div style={{ color: t.text }}>{children}</div>

        {footer && (
          <>
            <Hairline t={t} style={{ margin: "12px 0 10px" }} />
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {footer}
            </div>
          </>
        )}
      </Glass>
    </div>
  );
};

export default Modal;
