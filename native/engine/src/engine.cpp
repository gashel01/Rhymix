#include "rhymix/engine.h"

namespace rhymix {

AudioEngine::AudioEngine(Config config) : config_(config) {}

bool AudioEngine::start() {
    // TODO(phase 1): wire ASIO (Windows) / CoreAudio (macOS) here. Returning false until then
    // so nothing pretends to be working audio I/O.
    running_ = false;
    return running_;
}

void AudioEngine::stop() {
    running_ = false;
}

} // namespace rhymix
