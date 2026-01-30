import React from "react";

export const MainHeader = ({ title, subtitle, t }) => (
    <div style={{ flex: "1 1 340px", minWidth: 240 }}>
        <div style={{ fontSize: 26, fontWeight: 550, color: t.text, lineHeight: 1.1, fontFamily: "Utendo" }}>
            {title}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 150, color: t.subtext, fontFamily: "DM Sans" }}>
            {subtitle}
        </div>
    </div>
)

export default MainHeader;