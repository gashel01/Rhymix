import React from "react";

/**
 * Page title.
 *
 * This was 28px at weight 900 in uppercase, which made "YOUR UPLOADED FILES"
 * the loudest thing on the screen — and it is the least useful thing there:
 * you just clicked the sidebar item that brought you here. Uppercase in this
 * design belongs to small section labels; at display size it reads as a banner
 * rather than a heading.
 *
 * The subtitle also rendered its own empty line when there was no subtitle,
 * pushing the content below it down for nothing.
 */
export const MainHeader = ({ title, subtitle, t }) => (
  <div style={{ flex: "1 1 340px", minWidth: 240 }}>
    <div
      style={{
        fontSize: 22,
        fontWeight: 650,
        letterSpacing: "-0.02em",
        margin: 0,
        color: "rgba(255, 255, 255, 0.92)",
        lineHeight: 1.2,
      }}
    >
      {title}
    </div>
    {subtitle ? (
      <div style={{ marginTop: 2, fontSize: 13, color: t?.subtext }}>
        {subtitle}
      </div>
    ) : null}
  </div>
);

export default MainHeader;
