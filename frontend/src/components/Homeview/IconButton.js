import React from "react";
import Btn from "./Btn.js";
export const IconButton = ({ variant, onClick, style, title, t , icon}) => (
<Btn
variant={variant}
onClick={onClick}
style={style}
title={title}
t={t}
>
<span style={{ display: "flex", alignItems: "center", gap: 10 , fontFamily: "DM Sans"}}>
  {icon}
  {title}
</span>
</Btn>

)

export default IconButton;