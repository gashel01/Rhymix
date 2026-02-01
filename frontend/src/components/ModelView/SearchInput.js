import React from 'react'

export const SearchInput = ({
  t,
  value,
  onChange,
  placeholder,
  leftIcon,
  rightNode,
  onFocus,
  onKeyDown,
  inputRef,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 44,
      padding: "0 12px",
      borderRadius: 16,
      border: `1px solid ${t.hairline}`,
      background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
      boxShadow: t.shadowSoft,
      minWidth: 260,
      flex: "1 1 360px",
      position: "relative",
      zIndex: 2,
    }}
  >
    <span style={{ display: "inline-flex", color: t.subtext }}>{leftIcon}</span>
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        outline: "none",
        color: t.text,
        fontSize: 14,
        fontWeight: 650,
      }}
    />
    {rightNode}
  </div>
);
