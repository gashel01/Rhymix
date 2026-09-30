# Phase-1 native audio I/O engine — the piece that exists purely to prove out ASIO/CoreAudio
# bridging and low-latency I/O before plugin hosting is even attempted. See native/README.md.

add_library(rhymix_engine STATIC
    src/engine.cpp
)

target_include_directories(rhymix_engine PUBLIC include)
