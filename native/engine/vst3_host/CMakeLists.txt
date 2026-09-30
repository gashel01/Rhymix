cmake_minimum_required(VERSION 3.25)

# Pulls in Steinberg's own VST3 SDK CMake modules and target-creation functions instead of
# hand-listing every source file the sdk_hosting/sdk_common/base/pluginterfaces libraries need —
# those are Steinberg's own build system, reused as-is. See native/engine/third_party/README.md
# for how to fetch the SDK this expects at ../third_party/vst3sdk.
set(SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/vst3sdk")

if(NOT EXISTS "${SDK_ROOT}/CMakeLists.txt")
    message(FATAL_ERROR
        "VST3 SDK not found at ${SDK_ROOT}. Fetch it first — see native/engine/third_party/README.md."
    )
endif()

list(APPEND CMAKE_MODULE_PATH "${SDK_ROOT}/cmake/modules")
include(SMTG_VST3_SDK)

project(rhymix_vst3_host)

smtg_setup_platform_toolset()
smtg_setup_symbol_visibility()

set(ROOT "${SDK_ROOT}")
set(public_sdk_SOURCE_DIR ${SDK_ROOT}/public.sdk)
set(pluginterfaces_SOURCE_DIR ${SDK_ROOT}/pluginterfaces)
include_directories(${SDK_ROOT})

# Only the library targets this addon needs — deliberately NOT add_subdirectory()-ing the SDK
# root, which would also configure every hosting/plugin sample (editorhost, audiohost, the full
# plugin-examples tree) and their own dependencies (VSTGUI etc.) that this addon has no use for.
smtg_create_lib_base_target()
smtg_create_pluginterfaces_target()
smtg_create_public_sdk_common_target()
smtg_create_public_sdk_target()
smtg_create_public_sdk_hosting_target()

# cmake-js provides CMAKE_JS_INCLUDE_DIR / CMAKE_JS_SRC / CMAKE_JS_LIB when invoked via `npx
# cmake-js`. node-addon-api ships its own CMake config too.
execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

add_library(${PROJECT_NAME} SHARED
    ${CMAKE_JS_SRC}
    src/addon.cpp
    ${SDK_ROOT}/public.sdk/source/vst/hosting/module_win32.cpp
    ${SDK_ROOT}/public.sdk/source/common/memorystream.cpp
)

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_INC}
    ${NODE_ADDON_API_DIR}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_LIB}
    sdk_hosting
    user32
    gdi32
)

target_compile_features(${PROJECT_NAME} PUBLIC cxx_std_17)
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_DISABLE_CPP_EXCEPTIONS=0)
