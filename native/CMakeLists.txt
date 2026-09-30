# Rhymix native shell — top-level build config.
#
# STATUS: skeleton only, never compiled. No toolchain (Visual Studio Build Tools, Xcode, the
# Steinberg VST3 SDK checkout) has been installed or vendored in this environment — see
# native/README.md for why that wasn't done unattended.
#
# Phase 1 (this file targets): native audio I/O engine only, no plugin hosting yet.
# Phase 2/3 (not yet reflected here): add vst3sdk/ and the AudioToolbox bridge once phase 1
# actually builds and the shell framework decision (docs/NATIVE_SHELL_PLAN.md) has landed.

cmake_minimum_required(VERSION 3.24)
project(rhymix_native_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(WIN32)
    # ASIO-based audio I/O on Windows. Steinberg's ASIO SDK is a separate free download under
    # its own license (not the VST3 SDK) — not vendored here yet.
    message(STATUS "Rhymix native engine: Windows target (ASIO backend planned, not wired yet)")
elseif(APPLE)
    # CoreAudio is part of the macOS SDK, no extra licensing. UNVERIFIED: nothing in this repo
    # has ever been built on macOS — this branch is written from documentation, not tested.
    message(STATUS "Rhymix native engine: macOS target (CoreAudio backend planned, unverified — no Mac available to build/test)")
else()
    message(FATAL_ERROR "Rhymix native engine only targets Windows and macOS.")
endif()

add_subdirectory(engine)

# Deliberately not added yet:
#   add_subdirectory(vst3_host)   # phase 2 — Steinberg VST3 SDK >= 3.8.0 (MIT-licensed as of
#                                 # Oct 2025) hosting; vendor it under third_party/vst3sdk and
#                                 # confirm the checked-out LICENSE.txt is actually MIT before
#                                 # relying on it, see docs/NATIVE_SHELL_PLAN.md §3.
#   add_subdirectory(au_host)     # phase 3 — macOS AudioUnitSDK (Apache-2.0) hosting
#   add_subdirectory(clap_host)   # phase 3 — MIT-licensed free-audio/clap hosting
