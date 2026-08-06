import React from "react";

export const MainHeader = ({ title, subtitle, t }) => (
    <div style={{ flex: "1 1 340px", minWidth: 240 }}>
        <div style={{fontSize: 28,
    fontWeight: 900,
    letterSpacing: -0.02,
    margin: 0,
    textTransform: "uppercase",
    color: "rgba(255, 255, 255, 0.92)",
    lineHeight: 1.1 }}>
            {title}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 150, color: t.subtext, fontFamily: "DM Sans" }}>
            {subtitle}
        </div>
    </div>
)

export default MainHeader;