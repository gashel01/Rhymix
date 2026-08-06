import React from "react";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
export const FavBtn = ({ isFavorite, handleFavoriteClick, t }) => {

  return (
    <button
      type="button"
      onClick={handleFavoriteClick}
      title={isFavorite ? "Unfavorite" : "Favorite"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 8,
        border: `1px solid ${t.hairline}`,
        background: t.isDark ? "rgba(255,255,255,0.04)" : t.cardB,
        color: isFavorite ? "#f5c542" : t.subtext,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {isFavorite ? <StarIcon style={{ fontSize: 16 }} /> : <StarBorderIcon style={{ fontSize: 16 }} />}
    </button>
  );
};






