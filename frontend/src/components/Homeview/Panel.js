import React from "react";

export const Panel = ({ children, style ,t}) => (
    <div
      style={{
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
            // backdropFilter: "blur(18px) saturate(140%)",
            // WebkitBackdropFilter: "blur(18px) saturate(140%)",
        boxShadow: t.shadowSoft,
     
        ...style,
      }}
    >
      {children}
    </div>
  );

export default Panel;