#pragma once

#include <cstddef>
#include <cstdint>

namespace rhymix {

// Phase-1 skeleton only: no ASIO/CoreAudio backend is wired in yet. This exists so the CMake
// target links to *something* and the IPC bridge to the shell UI has a real class to call once
// the backend is implemented. See native/README.md for phasing.
class AudioEngine {
public:
    struct Config {
        double sampleRateHz = 48000.0;
        std::uint32_t bufferSizeFrames = 256;
    };

    explicit AudioEngine(Config config);

    // Returns false until a real ASIO/CoreAudio backend is implemented.
    bool start();
    void stop();

    bool isRunning() const { return running_; }

private:
    Config config_;
    bool running_ = false;
};

} // namespace rhymix
