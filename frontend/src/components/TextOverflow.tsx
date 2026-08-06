import React, { useRef, useEffect, useState, CSSProperties, ReactNode, useCallback } from "react";
import Tooltip from "@mui/material/Tooltip";
import "./TextOverflow.css";

interface TextOverflowProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  tooltipPosition?: "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  tooltipWidth?: string | number;
  tooltipTitle?: string;
  tooltipIcon?: ReactNode;
  tooltipArrowVisible?: boolean;
  children?: ReactNode;
  width?: string | number;
  onClick?: (event: React.MouseEvent) => void;
  preserveParentStyling?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
}

const TextOverflow: React.FC<TextOverflowProps> = ({
  text,
  className = "",
  style = {},
  tooltipPosition = "top",
  tooltipWidth,
  tooltipTitle,
  tooltipIcon,
  tooltipArrowVisible = true,
  children,
  width,
  onClick,
  preserveParentStyling = false,
  isSelected = false,
  isDisabled = false
}) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if text is overflowing its container
  const checkOverflow = useCallback(() => {
    if (textRef.current) {
      const isTextOverflowing = textRef.current.scrollWidth > textRef.current.clientWidth;
      setIsOverflowing(isTextOverflowing);
    }
  }, [text]); 

  // Set up overflow detection and listeners
  useEffect(() => {
    // Initial check with delay for more reliable measurements
    const timeoutId = setTimeout(checkOverflow, 50);
    
    // Check on resize
    window.addEventListener("resize", checkOverflow);
    
    // Use MutationObserver to detect DOM changes that might affect overflow
    const observer = new MutationObserver(checkOverflow);
    if (containerRef.current?.parentElement) {
      observer.observe(containerRef.current.parentElement, { 
        attributes: true, 
        childList: true,
        subtree: true 
      });
    }
    
    // Also check when style or className changes (after a delay)
    const styleChangeTimeoutId = setTimeout(checkOverflow, 50);
    
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(styleChangeTimeoutId);
      window.removeEventListener("resize", checkOverflow);
      observer.disconnect();
    };
  }, [checkOverflow, text, width, className, style]); 

  // Combine style with width, selected state, and disabled state
  const combinedStyle: CSSProperties = {
    ...style,
    ...(width ? { width } : {}),
    ...(isSelected ? { textDecoration: 'underline' } : {}),
    ...(isDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {})
  };

  // Create the text element that will be measured for overflow
  const textElement = (
    <div
      ref={textRef}
      className={`text-overflow ${className} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
      style={{
        ...combinedStyle,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
      onClick={isDisabled ? undefined : onClick}
    >
      {text}
    </div>
  );

  // Get the proper tooltip placement from our position prop
  const getTooltipPlacement = () => {
    switch(tooltipPosition) {
      case "top": return "top";
      case "bottom": return "bottom";
      case "left": return "left";
      case "right": return "right";
      case "top-left": return "top-start";
      case "top-right": return "top-end";
      case "bottom-left": return "bottom-start";
      case "bottom-right": return "bottom-end";
      default: return "top";
    }
  };

  // Render with or without tooltip based on overflow state
  return (
    <div 
      ref={containerRef} 
      className={`text-overflow-wrapper ${preserveParentStyling ? className : ''} ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`} 
      style={width ? { width } : undefined}
      onClick={isDisabled ? undefined : onClick}
    >
      {isOverflowing ? (
        <Tooltip
          title={tooltipTitle || text}
          placement={getTooltipPlacement()}
          arrow={true}
        >
          {textElement}
        </Tooltip>
      ) : (
        textElement
      )}
      {children}
    </div>
  );
};

export default TextOverflow; 