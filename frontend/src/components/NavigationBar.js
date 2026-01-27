import React from "react";
import {
  Box,
  Typography,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Button,
  Slider,
  Collapse,
} from "@mui/material";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import Brightness4 from "@mui/icons-material/Brightness4";
import Brightness7 from "@mui/icons-material/Brightness7";
import VolumeUp from "@mui/icons-material/VolumeUp";
import VolumeOff from "@mui/icons-material/VolumeOff";
import MenuIcon from "@mui/icons-material/Menu";
import { getGlassSurfaceStyles } from "../utils/glassStyles";

function NavigationBar({
  theme,
  darkMode,
  open,
  setOpen,
  handleThemeToggle,
  handleDrawerToggle,
  drawerOpen,
  navigationItems,
  currentView,
  handleNavigation,
  sidebarCollapsed,
  handleSidebarToggle,
  handleCleanDirectories,
  loading,
  onVolumeChange,
  muted,
  volume,
}) {
  const navCardHeight = sidebarCollapsed ? 60 : 76;
  const navCardRadius = 18;
  const navCardGlass = getGlassSurfaceStyles(theme, {
    borderRadius: navCardRadius,
    blur: 20,
    glowStrength: theme.palette.mode === "dark"
      ? "0 18px 36px rgba(0, 0, 0, 0.45)"
      : "0 16px 30px rgba(59, 130, 246, 0.18)",
    backgroundOpacity: theme.palette.mode === "dark" ? 0.55 : 0.85,
  });

  const sharedNavCardStyles = {
    ...navCardGlass,
    minHeight: navCardHeight,
    borderRadius: navCardRadius,
    px: sidebarCollapsed ? 1.5 : 2,
    py: sidebarCollapsed ? 1.5 : 1.5,
    justifyContent: sidebarCollapsed ? "center" : "flex-start",
    transition: "all 0.25s ease",
    "&.Mui-selected": {
      background:
        theme.palette.mode === "dark"
          ? "linear-gradient(135deg, rgba(0,122,255,0.22), rgba(10,10,14,0.88))"
          : "linear-gradient(135deg, rgba(0,122,255,0.2), rgba(255,255,255,0.92))",
      boxShadow:
        theme.palette.mode === "dark"
          ? "0 20px 40px rgba(0,0,0,0.45)"
          : "0 20px 36px rgba(59,130,246,0.22)",
      "&::before": {
        background:
          theme.palette.mode === "dark"
            ? "linear-gradient(135deg, rgba(255,255,255,0.45), rgba(0,122,255,0.35), rgba(255,255,255,0.15))"
            : "linear-gradient(135deg, rgba(255,255,255,1), rgba(0,122,255,0.5), rgba(255,255,255,0.8))",
      },
      "& .MuiListItemIcon-root": {
        color: theme.palette.primary.main,
      },
      "& .MuiListItemText-primary": {
        color: theme.palette.primary.main,
        fontWeight: 600,
      },
    },
    "&:hover": {
      transform: sidebarCollapsed ? "none" : "translateX(4px)",
      backgroundColor: theme.palette.action.hover,
    },
  };

  return (
    <>
      <IconButton
        onClick={handleDrawerToggle}
        sx={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 1300,
          display: { xs: "flex", sm: "none" },
          ...getGlassSurfaceStyles(theme, {
            borderRadius: 14,
            blur: 16,
            glowStrength: theme.palette.mode === "dark"
              ? "0 12px 24px rgba(0, 0, 0, 0.45)"
              : "0 12px 20px rgba(59, 130, 246, 0.2)",
          }),
          "&:hover": {
            backgroundColor: theme.palette.action.hover,
          },
        }}
      >
        <MenuIcon />
      </IconButton>

      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={handleDrawerToggle}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: { xs: "block", sm: "none" },
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            width: 300,
            ...getGlassSurfaceStyles(theme, {
              borderRadius: 0,
              blur: 26,
              backgroundOpacity: theme.palette.mode === "dark" ? 0.7 : 0.92,
              glowStrength: theme.palette.mode === "dark"
                ? "0 24px 50px rgba(0, 0, 0, 0.5)"
                : "0 20px 40px rgba(59, 130, 246, 0.18)",
            }),
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, color: theme.palette.primary.main }}>
            ✦ VocalForge
          </Typography>
          <IconButton onClick={handleDrawerToggle} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <List sx={{ pt: 2, px: 1 }}>
          {navigationItems.map((item) => (
            <ListItem key={item.id} disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                onClick={() => handleNavigation(item.id)}
                selected={currentView === item.id}
                sx={sharedNavCardStyles}
              >
                <ListItemIcon
                  sx={{
                    color:
                      currentView === item.id
                        ? theme.palette.primary.main
                        : theme.palette.text.secondary,
                    minWidth: 40,
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  secondary={item.description}
                  primaryTypographyProps={{
                    fontWeight: currentView === item.id ? 600 : 500,
                    fontSize: "0.95rem",
                    noWrap: true,
                  }}
                  secondaryTypographyProps={{
                    fontSize: "0.75rem",
                    color: theme.palette.text.secondary,
                    noWrap: true,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        <Box
          sx={{
            position: "absolute",
            bottom: 24,
            left: 16,
            right: 16,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 2,
              ...getGlassSurfaceStyles(theme, {
                borderRadius: 16,
                blur: 18,
                glowStrength: theme.palette.mode === "dark"
                  ? "0 10px 24px rgba(0, 0, 0, 0.45)"
                  : "0 12px 24px rgba(59, 130, 246, 0.18)",
              }),
            }}
          >
            <Typography
              variant="body2"
              sx={{
                color: theme.palette.text.secondary,
                fontWeight: 500,
              }}
            >
              Theme
            </Typography>

            <IconButton
              onClick={handleThemeToggle}
              sx={{
                color: theme.palette.text.secondary,
                "&:hover": {
                  color: theme.palette.primary.main,
                  backgroundColor: theme.palette.action.hover,
                },
              }}
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          </Box>
        </Box>
      </Drawer>

      <Box
        sx={{
          display: { xs: "none", sm: "flex" },
          width: sidebarCollapsed ? 80 : 288,
          flexShrink: 0,
          ...getGlassSurfaceStyles(theme, {
            borderRadius: 0,
            blur: 26,
            backgroundOpacity: theme.palette.mode === "dark" ? 0.72 : 0.92,
            glowStrength: theme.palette.mode === "dark"
              ? "0 24px 50px rgba(0, 0, 0, 0.45)"
              : "0 18px 36px rgba(59, 130, 246, 0.15)",
          }),
          transition: "width 0.3s ease-in-out",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: sidebarCollapsed ? 80 : 288,
            p: sidebarCollapsed ? 1 : 3,
            position: "fixed",
            height: "100vh",
            overflow: "hidden",
            transition: "width 0.3s ease-in-out",
            top: 0,
            left: 0,
          }}
        >
          <Box
            onClick={handleSidebarToggle}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
              mb: sidebarCollapsed ? 2 : 4,
              px: sidebarCollapsed ? 0 : 0,
            }}
          >
            {!sidebarCollapsed && (
              <Typography
                variant="h2"
                sx={{
                  fontWeight: 700,
                  color: theme.palette.primary.main,
                }}
              >
                VocalForge
              </Typography>
            )}
            {sidebarCollapsed && (
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  color: theme.palette.primary.main,
                  fontSize: "1.5rem",
                }}
              />
            )}
            <IconButton
              sx={{
                color: theme.palette.text.secondary,
                "&:hover": {
                  color: theme.palette.primary.main,
                  backgroundColor: theme.palette.action.hover,
                },
                p: 1,
              }}
              size="small"
            >
              {sidebarCollapsed && <MenuIcon sx={{ fontSize: 20 }} />}
            </IconButton>
          </Box>

          <List sx={{ p: 0, display: "grid", gap: 1 }}>
            {navigationItems.map((item) => (
              <ListItem key={item.id} disablePadding>
                <ListItemButton
                  onClick={() => handleNavigation(item.id)}
                  selected={currentView === item.id}
                  sx={sharedNavCardStyles}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <ListItemIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      minWidth: sidebarCollapsed ? 40 : 40,
                      justifyContent: "center",
                      transition: "color 0.2s ease",
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {!sidebarCollapsed && (
                    <Box>
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 500,
                          mb: 0.5,
                          transition: "color 0.2s ease",
                        }}
                        noWrap
                      >
                        {item.label}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: theme.palette.text.secondary,
                          lineHeight: 1.2,
                        }}
                        noWrap
                      >
                        {item.description}
                      </Typography>
                    </Box>
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>

          {!sidebarCollapsed && (
            <>
              <Divider sx={{ my: 3 }} />

              <Typography
                variant="overline"
                sx={{
                  color: theme.palette.text.secondary,
                  fontWeight: 600,
                  px: 1,
                  mb: 2,
                  display: "block",
                }}
              >
                Quick Actions
              </Typography>

              <Button
                fullWidth
                variant="outlined"
                onClick={() => handleCleanDirectories(true)}
                disabled={loading}
                sx={{
                  borderRadius: 2,
                  py: 1.5,
                  mb: 1,
                  justifyContent: "flex-start",
                  borderColor: theme.palette.divider,
                  color: theme.palette.text.primary,
                  "&:hover": {
                    borderColor: theme.palette.primary.main,
                    backgroundColor: theme.palette.primary.main + "10",
                  },
                }}
              >
                🧹 Clean All Data
              </Button>
            </>
          )}

          {sidebarCollapsed && (
            <Box sx={{ mt: 2 }}>
              <IconButton
                onClick={() => handleCleanDirectories(true)}
                disabled={loading}
                sx={{
                  color: theme.palette.text.secondary,
                  "&:hover": {
                    color: theme.palette.primary.main,
                    backgroundColor: theme.palette.action.hover,
                  },
                  p: 1,
                  width: "100%",
                  borderRadius: 2,
                  mb: 1,
                }}
                title="Clean All Data"
              >
                🧹
              </IconButton>
            </Box>
          )}

          <ClickAwayListener onClickAway={() => setOpen(false)}>
            <Box
              sx={{
                position: "absolute",
                bottom: 24,
                left: sidebarCollapsed ? 12 : 24,
                right: sidebarCollapsed ? 12 : 24,
              }}
            >
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: "hidden",
                  ...getGlassSurfaceStyles(theme, {
                    borderRadius: 16,
                    blur: 20,
                    glowStrength: theme.palette.mode === "dark"
                      ? "0 18px 36px rgba(0, 0, 0, 0.45)"
                      : "0 16px 30px rgba(59, 130, 246, 0.18)",
                  }),
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: sidebarCollapsed ? "center" : "space-between",
                    px: 1.25,
                    py: 1,
                  }}
                >
                  {!sidebarCollapsed && (
                    <Typography
                      variant="body2"
                      sx={{ p: 0.5, color: theme.palette.text.secondary, fontWeight: 600 }}
                    >
                      Settings
                    </Typography>
                  )}
                  <IconButton onClick={() => setOpen((o) => !o)} sx={{ p: 0.5, color: theme.palette.text.secondary }}>
                    {open ? <CloseIcon sx={{ fontSize: 18 }} /> : <SettingsIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Box>

                <Collapse in={open} unmountOnExit>
                  <Box sx={{ px: 1.5, pb: 1.25, display: "grid", gap: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontWeight: 500 }}>
                        Theme
                      </Typography>
                      <IconButton onClick={handleThemeToggle} sx={{ p: 0.5, color: theme.palette.text.secondary }}>
                        {darkMode ? <Brightness7 sx={{ fontSize: 20 }} /> : <Brightness4 sx={{ fontSize: 20 }} />}
                      </IconButton>
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <IconButton onClick={() => onVolumeChange(muted ? 0.8 : 0)} sx={{ p: 0.5, color: theme.palette.text.secondary }}>
                        {muted ? <VolumeOff sx={{ fontSize: 20 }} /> : <VolumeUp sx={{ fontSize: 20 }} />}
                      </IconButton>

                      <Slider
                        value={Math.round(volume * 100)}
                        onChange={(_, v) => onVolumeChange((Array.isArray(v) ? v[0] : v) / 100)}
                        min={0}
                        max={100}
                        size="small"
                      />
                    </Box>
                  </Box>
                </Collapse>
              </Box>
            </Box>
          </ClickAwayListener>
        </Box>
      </Box>
    </>
  );
}

export default NavigationBar;
