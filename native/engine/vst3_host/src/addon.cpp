// VST3 hosting proof of concept. Loads a real .vst3 module via Steinberg's own reference
// hosting code (VST3::Hosting::Module — the same class their own "validator" tool uses).
//
// loadPlugin(path) reports the real metadata the plugin declares: factory vendor/url/email, and
// every class it exposes (name, vendor, category, version, sub-categories).
//
// processAudioTest(path) goes further: instantiates the plugin's Audio Module Class, negotiates
// its default bus arrangement, runs one real block of a generated 440Hz sine wave through
// IAudioProcessor::process(), and reports real statistics (min/max/RMS, a finite-value check,
// and how far the output diverges from the input) read back from the actual output buffer — not
// just "the call didn't throw". See native/engine/vst3_host/README.md for what's still not here
// (GUI embedding, parameter automation, directory scanning, crash isolation, streaming/real-time
// loop, non-default bus arrangements).
//
// setProcessing(true) failing is treated as non-fatal (logged in the result, not thrown) — real
// DAWs call process() regardless of what it returns; some plugins (the iZotope RX 11 suite,
// confirmed on this machine) legitimately return kNotImplemented from it while still processing
// correctly. See https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558

#include <napi.h>
#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cctype>
#include <limits>
#include <fstream>
#include <filesystem>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <unordered_map>
#include <memory>
#include <cstring>

#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/common/memorystream.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/gui/iplugview.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

using VST3::Hosting::ClassInfo;
using VST3::Hosting::Module;

namespace {

Napi::Value LoadPlugin(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "loadPlugin(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("moduleName", Napi::String::New(env, module->getName()));
  result.Set("path", Napi::String::New(env, module->getPath()));

  const auto& factory = module->getFactory();
  auto factoryInfo = factory.info();
  Napi::Object factoryObj = Napi::Object::New(env);
  factoryObj.Set("vendor", Napi::String::New(env, factoryInfo.vendor()));
  factoryObj.Set("url", Napi::String::New(env, factoryInfo.url()));
  factoryObj.Set("email", Napi::String::New(env, factoryInfo.email()));
  result.Set("factory", factoryObj);

  std::vector<ClassInfo> classInfos = factory.classInfos();
  Napi::Array classesArray = Napi::Array::New(env, classInfos.size());
  for (size_t i = 0; i < classInfos.size(); ++i) {
    const ClassInfo& ci = classInfos[i];
    Napi::Object classObj = Napi::Object::New(env);
    classObj.Set("name", Napi::String::New(env, ci.name()));
    classObj.Set("vendor", Napi::String::New(env, ci.vendor()));
    classObj.Set("category", Napi::String::New(env, ci.category()));
    classObj.Set("version", Napi::String::New(env, ci.version()));
    classObj.Set("subCategories", Napi::String::New(env, ci.subCategoriesString()));
    classesArray.Set(static_cast<uint32_t>(i), classObj);
  }
  result.Set("classes", classesArray);

  return result;
}

// Real min/max/RMS/finite stats over one bus's worth of interleaved-by-channel float buffers,
// read back from actual memory the plugin wrote (or, for the input side, memory we wrote and are
// re-reading to sanity check our own signal generation).
struct BufferStats {
  double min = std::numeric_limits<double>::infinity();
  double max = -std::numeric_limits<double>::infinity();
  double rms = 0.0;
  bool allFinite = true;
  int32_t sampleCount = 0;
};

BufferStats ComputeStats(Steinberg::Vst::AudioBusBuffers& bus, int32_t numSamples) {
  BufferStats stats;
  double sumSq = 0.0;
  for (int32_t ch = 0; ch < bus.numChannels; ++ch) {
    float* buf = bus.channelBuffers32[ch];
    if (!buf) continue;
    for (int32_t i = 0; i < numSamples; ++i) {
      float v = buf[i];
      if (!std::isfinite(v)) {
        stats.allFinite = false;
        continue;
      }
      stats.min = std::min(stats.min, static_cast<double>(v));
      stats.max = std::max(stats.max, static_cast<double>(v));
      sumSq += static_cast<double>(v) * static_cast<double>(v);
      stats.sampleCount++;
    }
  }
  stats.rms = stats.sampleCount > 0 ? std::sqrt(sumSq / stats.sampleCount) : 0.0;
  return stats;
}

Napi::Object StatsToJs(Napi::Env env, const BufferStats& stats) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("min", Napi::Number::New(env, stats.sampleCount > 0 ? stats.min : 0.0));
  obj.Set("max", Napi::Number::New(env, stats.sampleCount > 0 ? stats.max : 0.0));
  obj.Set("rms", Napi::Number::New(env, stats.rms));
  obj.Set("allFinite", Napi::Boolean::New(env, stats.allFinite));
  obj.Set("sampleCount", Napi::Number::New(env, stats.sampleCount));
  return obj;
}

Napi::Value ProcessAudioTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processAudioTest(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  // A real host context, not nullptr: some plugins call back into IHostApplication during
  // initialize()/createInstance() and misbehave (or refuse to initialize) without one.
  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  // Find the plugin's Audio Module Class. Copy the UID out of the loop instead of keeping a
  // pointer/reference into classInfos() — that vector is a temporary returned by value, and a
  // pointer into it would dangle the moment the loop's enclosing full-expression ends.
  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component) {
    Napi::Error::New(env, "factory.createInstance<IComponent> failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component->initialize() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Everything past this point must go through this cleanup path on every exit, success or
  // error — a plugin left half-activated is exactly the kind of state corruption a one-shot
  // proof like this needs to prove it does NOT leave behind (see the "run twice" check the
  // caller does at the JS level).
  auto terminateComponent = [&]() { component->terminate(); };

  // "Distributable" plugins (a separate Component for audio processing and EditController for
  // parameters/UI — the architecture most real commercial plugins use, vs. ADelay's "single
  // component doubling as its own controller") refuse to leave setProcessing(true) at
  // kNotImplemented until the Controller has been created, connected to the Component via
  // IConnectionPoint in both directions, and handed the Component's state via
  // setComponentState() — confirmed by testing without this block first (see README). A plugin
  // with no separate controller (getControllerClassId returns kResultFalse) skips all of this
  // and behaves exactly as before.
  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  bool hasSeparateController = false;
  bool controllerConnected = false;
  bool controllerStateSynced = false;
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    hasSeparateController = true;
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller) {
      if (controller->initialize(&hostApplication) != kResultOk) {
        controller = nullptr;
      }
    }
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        tresult r1 = componentCP->connect(controllerCP.get());
        tresult r2 = controllerCP->connect(componentCP.get());
        controllerConnected = (r1 == kResultOk && r2 == kResultOk);
      }

      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controllerStateSynced = controller->setComponentState(&componentState) == kResultOk;
      }
    }
  }

  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  const int32 numInputBuses = component->getBusCount(kAudio, kInput);
  const int32 numOutputBuses = component->getBusCount(kAudio, kOutput);
  if (numInputBuses < 1 || numOutputBuses < 1) {
    terminateController();
    terminateComponent();
    Napi::Error::New(
        env, "Plugin has no main audio input/output bus (numInputBuses=" +
                 std::to_string(numInputBuses) + ", numOutputBuses=" + std::to_string(numOutputBuses) + ")")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  bool haveInBusInfo = component->getBusInfo(kAudio, kInput, 0, inBusInfo) == kResultOk;
  bool haveOutBusInfo = component->getBusInfo(kAudio, kOutput, 0, outBusInfo) == kResultOk;
  if (!haveInBusInfo || !haveOutBusInfo) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->getBusInfo() failed for the main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Re-confirm the bus arrangement explicitly. Some plugins' internal setProcessing()
  // implementation checks a flag that only setBusArrangements() sets, even when the arrangement
  // requested is identical to what getBusInfo() already reported as the default — omitting this
  // call is what made setProcessing(true) fail outright against real iZotope RX plugins during
  // development of this function, despite setActive(true) having already succeeded.
  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  // Re-read: setBusArrangements is allowed to return kResultFalse and settle on a different
  // arrangement than requested (BusInfo::channelCount doc: "need to be recheck after
  // setBusArrangements is called") — HostProcessData::prepare() must size buffers against
  // whatever the plugin actually ended up with, not what we asked for.
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;

  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // All buses start inactive per the VST3 spec ("All busses are initially inactive") — this is
  // not optional bookkeeping, a plugin is entitled to silently no-op process() on an inactive
  // bus.
  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);

  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };

  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // setProcessing(true) failing (kResultFalse/kNotImplemented) is not treated as fatal here.
  // Confirmed via a Steinberg developer forum thread reporting the exact same symptom against
  // the exact same plugin family:
  // https://forums.steinberg.net/t/iaudioprocessor-setprocessing-fails-in-many-plugins/785558
  // "iZotope and most of the iZotope plugins" return this from custom hosts while working fine
  // in commercial DAWs — the consensus from experienced VST3 host developers is that DAWs call
  // process() regardless of this return value; the varied return codes reflect differing plugin
  // implementations of an essentially advisory call, not a real failure state. Recorded in the
  // result object (setProcessingResult/setProcessingOk) rather than hidden either way.
  tresult setProcessingResult = processor->setProcessing(true);
  bool setProcessingOk = setProcessingResult == kResultOk;

  HostProcessData processData;
  processData.prepare(*component, blockSize, kSample32);

  // A real, non-silent 440Hz test tone — silence would let a totally broken plugin "pass" by
  // doing nothing.
  constexpr double kPi = 3.14159265358979323846;
  if (processData.numInputs > 0) {
    for (int32 ch = 0; ch < processData.inputs[0].numChannels; ++ch) {
      float* buf = processData.inputs[0].channelBuffers32[ch];
      if (!buf) continue;
      for (int32 i = 0; i < blockSize; ++i) {
        buf[i] = 0.5f * static_cast<float>(std::sin(2.0 * kPi * 440.0 * static_cast<double>(i) / sampleRate));
      }
    }
  }

  BufferStats inputStatsBefore = processData.numInputs > 0
      ? ComputeStats(processData.inputs[0], blockSize)
      : BufferStats{};

  ProcessContext processContext{};
  processContext.sampleRate = sampleRate;
  processData.processContext = &processContext;
  processData.numSamples = blockSize;

  tresult processResult = processor->process(processData);

  BufferStats outputStats = processData.numOutputs > 0
      ? ComputeStats(processData.outputs[0], blockSize)
      : BufferStats{};

  // Does the output differ from the input we generated? Computed before shutdown, from the same
  // buffers process() just wrote into — a real numeric comparison, not an assumption.
  double maxAbsDiffFromInput = 0.0;
  bool comparedSameChannelCount = false;
  if (processData.numInputs > 0 && processData.numOutputs > 0) {
    AudioBusBuffers& inBus = processData.inputs[0];
    AudioBusBuffers& outBus = processData.outputs[0];
    int32 compareChannels = std::min(inBus.numChannels, outBus.numChannels);
    comparedSameChannelCount = compareChannels == outBus.numChannels && compareChannels == inBus.numChannels;
    for (int32 ch = 0; ch < compareChannels; ++ch) {
      float* inBuf = inBus.channelBuffers32[ch];
      float* outBuf = outBus.channelBuffers32[ch];
      if (!inBuf || !outBuf) continue;
      for (int32 i = 0; i < blockSize; ++i) {
        maxAbsDiffFromInput = std::max(maxAbsDiffFromInput, std::abs(static_cast<double>(outBuf[i]) - static_cast<double>(inBuf[i])));
      }
    }
  }

  // Clean shutdown, mirroring the reverse of the setup sequence exactly.
  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("setProcessingResult", Napi::Number::New(env, setProcessingResult));
  result.Set("setProcessingOk", Napi::Boolean::New(env, setProcessingOk));
  result.Set("processResult", Napi::Number::New(env, processResult));
  result.Set("processOk", Napi::Boolean::New(env, processResult == kResultOk));
  result.Set("inputChannels", Napi::Number::New(env, inBusInfo.channelCount));
  result.Set("outputChannels", Napi::Number::New(env, outBusInfo.channelCount));
  result.Set("blockSize", Napi::Number::New(env, blockSize));
  result.Set("sampleRate", Napi::Number::New(env, sampleRate));
  result.Set("inputStats", StatsToJs(env, inputStatsBefore));
  result.Set("outputStats", StatsToJs(env, outputStats));
  result.Set("maxAbsDiffFromInput", Napi::Number::New(env, maxAbsDiffFromInput));
  result.Set("comparedSameChannelCount", Napi::Boolean::New(env, comparedSameChannelCount));
  result.Set("hasSeparateController", Napi::Boolean::New(env, hasSeparateController));
  result.Set("controllerConnected", Napi::Boolean::New(env, controllerConnected));
  result.Set("controllerStateSynced", Napi::Boolean::New(env, controllerStateSynced));

  return result;
}

// Resolves the ambiguity processAudioTest() left open: a plugin whose output is bit-identical
// to its input is consistent with EITHER "correctly did nothing to clean test audio" (a
// restoration tool with nothing to fix) OR "silently bypassing regardless of what it's handed".
// This runs process() TWICE on the exact same input buffer, with a real controller-side
// parameter pushed to two different values via a genuine IParameterChanges queue (the actual
// VST3 automation path — NOT just calling setParamNormalized() on the controller and hoping the
// processor notices, which it has no obligation to do since Component and EditController are
// separate objects). If real processing is happening, the two runs' outputs should differ from
// each other. Prefers the plugin's own kIsBypass-flagged parameter when it has one (the VST3
// spec's own designated "prove you can turn processing on and off" parameter) since that's the
// most semantically decisive choice available; falls back to the first automatable parameter
// otherwise.
Napi::Value ProcessParamDiffTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processParamDiffTest(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController — parameter-diff test needs one").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Pick the parameter: prefer the spec's own kIsBypass flag, else the first automatable one.
  ParamID chosenParamId = 0;
  std::string chosenParamTitle;
  bool foundParam = false;
  bool isBypassParam = false;
  {
    int32 count = controller->getParameterCount();
    ParameterInfo fallbackInfo{};
    bool haveFallback = false;
    for (int32 i = 0; i < count; ++i) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      if (pi.flags & ParameterInfo::kIsBypass) {
        chosenParamId = pi.id;
        foundParam = true;
        isBypassParam = true;
        // UTF-16 title -> narrow, good enough for a diagnostic string.
        for (int j = 0; pi.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(pi.title[j]);
        break;
      }
      if (!haveFallback && (pi.flags & ParameterInfo::kCanAutomate) && !(pi.flags & ParameterInfo::kIsReadOnly)) {
        fallbackInfo = pi;
        haveFallback = true;
      }
    }
    if (!foundParam && haveFallback) {
      chosenParamId = fallbackInfo.id;
      foundParam = true;
      for (int j = 0; fallbackInfo.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(fallbackInfo.title[j]);
    }
  }
  if (!foundParam) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "No automatable/bypass parameter found on this plugin's controller").ThrowAsJavaScriptException();
    return env.Null();
  }

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1 ||
      component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
      component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no usable main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }

  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;

  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };

  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Non-fatal, same rationale as processAudioTest (see the forum link at the top of this file).
  processor->setProcessing(true);

  constexpr double kPi = 3.14159265358979323846;
  auto fillTone = [&](HostProcessData& pd) {
    if (pd.numInputs > 0) {
      for (int32 ch = 0; ch < pd.inputs[0].numChannels; ++ch) {
        float* buf = pd.inputs[0].channelBuffers32[ch];
        if (!buf) continue;
        for (int32 i = 0; i < blockSize; ++i) {
          buf[i] = 0.5f * static_cast<float>(std::sin(2.0 * kPi * 440.0 * static_cast<double>(i) / sampleRate));
        }
      }
    }
  };

  // Bypass semantics: value 1.0 = bypassed (passthrough expected), 0.0 = not bypassed (real
  // processing expected). For a non-bypass fallback parameter we still just compare the two
  // extremes — real processing should make SOME difference at min vs max for a parameter the
  // plugin itself declared automatable.
  double valueA = isBypassParam ? 1.0 : 0.0;
  double valueB = isBypassParam ? 0.0 : 1.0;

  auto runOnce = [&](double paramValue, BufferStats& outStats, tresult& processResult) {
    HostProcessData pd;
    pd.prepare(*component, blockSize, kSample32);
    fillTone(pd);

    ParameterChanges changes;
    int32 idx = 0;
    IParamValueQueue* q = changes.addParameterData(chosenParamId, idx);
    if (q) {
      int32 pointIdx = 0;
      q->addPoint(0, paramValue, pointIdx);
    }

    ProcessContext ctx{};
    ctx.sampleRate = sampleRate;
    pd.processContext = &ctx;
    pd.numSamples = blockSize;
    pd.inputParameterChanges = &changes;

    processResult = processor->process(pd);
    outStats = pd.numOutputs > 0 ? ComputeStats(pd.outputs[0], blockSize) : BufferStats{};

    // Stash the raw output for the cross-run diff below — HostProcessData owns its buffers and
    // frees them when it goes out of scope, so copy out what's needed before that happens.
    std::vector<float> raw;
    if (pd.numOutputs > 0 && pd.outputs[0].numChannels > 0 && pd.outputs[0].channelBuffers32[0]) {
      raw.assign(pd.outputs[0].channelBuffers32[0], pd.outputs[0].channelBuffers32[0] + blockSize);
    }
    return raw;
  };

  BufferStats statsA{}, statsB{};
  tresult processResultA = kResultFalse, processResultB = kResultFalse;
  std::vector<float> outputA = runOnce(valueA, statsA, processResultA);
  std::vector<float> outputB = runOnce(valueB, statsB, processResultB);

  double maxAbsDiffBetweenRuns = 0.0;
  bool comparable = outputA.size() == outputB.size() && !outputA.empty();
  if (comparable) {
    for (size_t i = 0; i < outputA.size(); ++i) {
      maxAbsDiffBetweenRuns = std::max(maxAbsDiffBetweenRuns, static_cast<double>(std::abs(outputA[i] - outputB[i])));
    }
  }

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("paramId", Napi::Number::New(env, chosenParamId));
  result.Set("paramTitle", Napi::String::New(env, chosenParamTitle));
  result.Set("isBypassParam", Napi::Boolean::New(env, isBypassParam));
  result.Set("valueA", Napi::Number::New(env, valueA));
  result.Set("valueB", Napi::Number::New(env, valueB));
  result.Set("processResultA", Napi::Number::New(env, processResultA));
  result.Set("processResultB", Napi::Number::New(env, processResultB));
  result.Set("statsA", StatsToJs(env, statsA));
  result.Set("statsB", StatsToJs(env, statsB));
  result.Set("comparable", Napi::Boolean::New(env, comparable));
  result.Set("maxAbsDiffBetweenRuns", Napi::Number::New(env, maxAbsDiffBetweenRuns));
  return result;
}

// Gaël's latency hypothesis (docs/RX11_VST3_INVESTIGATION.md, 2026-09-25 latency addendum):
// De-click/De-crackle/De-clip/De-plosive are transient-detection tools that plausibly carry real
// internal lookahead latency. ProcessParamDiffTest above runs exactly one 512-sample block per
// bypass state — a genuinely-processing plugin whose lookahead buffer hasn't finished filling
// yet would look identical to a true silent bypass in that test, for reasons that have nothing to
// do with whether it's actually working. This queries IAudioProcessor::getLatencySamples() for
// real (right after setActive(true), the point a real host would trust it), runs enough
// consecutive blocks to flush that much lookahead plus a real comparison window, feeds genuinely
// impulsive "click" content each block (a transient detector has nothing to react to in a clean
// tone), and reports the bypass-toggle diff BOTH across the whole run and restricted to the
// region past the reported latency — the second number is the one that actually answers the
// question if latency turns out to matter.
Napi::Value ProcessLatencyAwareDiffTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processLatencyAwareDiffTest(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  ParamID chosenParamId = 0;
  std::string chosenParamTitle;
  bool foundParam = false;
  bool isBypassParam = false;
  if (controller) {
    int32 count = controller->getParameterCount();
    ParameterInfo fallbackInfo{};
    bool haveFallback = false;
    for (int32 i = 0; i < count; ++i) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      if (pi.flags & ParameterInfo::kIsBypass) {
        chosenParamId = pi.id;
        foundParam = true;
        isBypassParam = true;
        for (int j = 0; pi.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(pi.title[j]);
        break;
      }
      if (!haveFallback && (pi.flags & ParameterInfo::kCanAutomate) && !(pi.flags & ParameterInfo::kIsReadOnly)) {
        fallbackInfo = pi;
        haveFallback = true;
      }
    }
    if (!foundParam && haveFallback) {
      chosenParamId = fallbackInfo.id;
      foundParam = true;
      for (int j = 0; fallbackInfo.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(fallbackInfo.title[j]);
    }
  }

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1 ||
      component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
      component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no usable main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }

  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;

  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };

  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // The actual point of this test: read this for real, at the lifecycle point the SDK documents
  // it as meaningful (after setupProcessing + setActive), for every plugin, regardless of whether
  // the rest of the test below finds anything.
  int32 latencySamples = static_cast<int32>(processor->getLatencySamples());

  processor->setProcessing(true);

  constexpr double kPi = 3.14159265358979323846;
  // Real impulsive "click" content, not a clean tone — a transient/click detector has nothing to
  // react to in a pure sine. A steady 220Hz tone with a near-full-scale spike stamped into the
  // middle of every block, so a multi-block run keeps handing it fresh defects, not just in the
  // first block that a short single-block test would have covered anyway.
  auto fillClicky = [&](float* buf, int32 n, int32 blockIndex) {
    for (int32 i = 0; i < n; ++i) {
      double t = static_cast<double>(blockIndex * blockSize + i) / sampleRate;
      buf[i] = 0.3f * static_cast<float>(std::sin(2.0 * kPi * 220.0 * t));
    }
    int32 spikePos = n / 2;
    for (int32 k = 0; k < 4 && spikePos + k < n; ++k) {
      buf[spikePos + k] = (k % 2 == 0) ? 0.98f : -0.98f;
    }
  };

  // Enough blocks to run real material through and flush any reported lookahead: the latency
  // itself plus a healthy comparison window past it.
  int32 totalSamples = std::max(4096, latencySamples * 2 + 4096);
  int32 numBlocks = (totalSamples + blockSize - 1) / blockSize;

  auto runOnce = [&](double paramValue) {
    std::vector<float> full;
    full.reserve(static_cast<size_t>(numBlocks) * blockSize);
    for (int32 b = 0; b < numBlocks; ++b) {
      HostProcessData pd;
      pd.prepare(*component, blockSize, kSample32);
      if (pd.numInputs > 0) {
        for (int32 ch = 0; ch < pd.inputs[0].numChannels; ++ch) {
          float* buf = pd.inputs[0].channelBuffers32[ch];
          if (buf) fillClicky(buf, blockSize, b);
        }
      }

      ParameterChanges changes;
      if (foundParam && b == 0) {
        int32 idx = 0;
        IParamValueQueue* q = changes.addParameterData(chosenParamId, idx);
        if (q) {
          int32 pointIdx = 0;
          q->addPoint(0, paramValue, pointIdx);
        }
      }

      // Same real ProcessContext convention as renderAudioFile (2026-09-25 addendum), kept
      // accurate per block rather than set once and left at 0.
      ProcessContext ctx{};
      ctx.sampleRate = sampleRate;
      ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
      ctx.tempo = 120.0;
      ctx.timeSigNumerator = 4;
      ctx.timeSigDenominator = 4;
      ctx.projectTimeSamples = static_cast<TSamples>(b) * blockSize;
      pd.processContext = &ctx;
      pd.numSamples = blockSize;
      if (foundParam && b == 0) pd.inputParameterChanges = &changes;

      processor->process(pd);

      if (pd.numOutputs > 0 && pd.outputs[0].numChannels > 0 && pd.outputs[0].channelBuffers32[0]) {
        for (int32 i = 0; i < blockSize; ++i) full.push_back(pd.outputs[0].channelBuffers32[0][i]);
      }
    }
    return full;
  };

  double valueA = isBypassParam ? 1.0 : 0.0;
  double valueB = isBypassParam ? 0.0 : 1.0;
  std::vector<float> outputA = foundParam ? runOnce(valueA) : std::vector<float>{};
  std::vector<float> outputB = foundParam ? runOnce(valueB) : std::vector<float>{};

  double maxAbsDiffFull = 0.0;
  double maxAbsDiffPastLatency = 0.0;
  bool comparable = foundParam && !outputA.empty() && outputA.size() == outputB.size();
  if (comparable) {
    size_t latOffset = static_cast<size_t>(std::max(0, latencySamples));
    if (latOffset >= outputA.size()) latOffset = 0;  // reported latency longer than our whole run
    for (size_t i = 0; i < outputA.size(); ++i) {
      double d = static_cast<double>(std::abs(outputA[i] - outputB[i]));
      maxAbsDiffFull = std::max(maxAbsDiffFull, d);
      if (i >= latOffset) maxAbsDiffPastLatency = std::max(maxAbsDiffPastLatency, d);
    }
  }

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("latencySamples", Napi::Number::New(env, latencySamples));
  result.Set("foundParam", Napi::Boolean::New(env, foundParam));
  result.Set("paramTitle", Napi::String::New(env, chosenParamTitle));
  result.Set("isBypassParam", Napi::Boolean::New(env, isBypassParam));
  result.Set("totalSamplesPerRun", Napi::Number::New(env, static_cast<double>(numBlocks) * blockSize));
  result.Set("comparable", Napi::Boolean::New(env, comparable));
  result.Set("maxAbsDiffFull", Napi::Number::New(env, maxAbsDiffFull));
  result.Set("maxAbsDiffPastLatency", Napi::Number::New(env, maxAbsDiffPastLatency));
  return result;
}

// DIAGNOSTIC ONLY. Dumps every controller-exposed parameter (id, title, short title, default
// normalized value, flags) for a plugin — used to find De-hum's "Learn" control by name, since
// its own GUI (screenshotted 2026-09-25) says "Click Learn to begin listening to the audio for
// hum" but the bypass-scan logic elsewhere in this file only ever looks for kIsBypass or the
// first automatable fallback, never prints the full list.
Napi::Value ListPluginParams(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "listPluginParams(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  for (const auto& ci : factory.classInfos()) {
    if (ci.category() == std::string(kVstAudioEffectClass)) {
      audioClassId = ci.ID();
      foundAudioClass = true;
      break;
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      // Same bridge as ProcessParamDiffTest/ProcessLatencyAwareDiffTest — turns out to matter
      // here too: without connect()+setComponentState(), some plugins (De-hum among them,
      // confirmed by hand) report getParameterCount()==0 even though they clearly have real
      // controller-side parameters once properly bridged.
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController").ThrowAsJavaScriptException();
    return env.Null();
  }

  int32 count = controller->getParameterCount();
  Napi::Array arr = Napi::Array::New(env, static_cast<uint32_t>(std::max(0, count)));
  for (int32 i = 0; i < count; ++i) {
    ParameterInfo pi{};
    if (controller->getParameterInfo(i, pi) != kResultOk) continue;
    std::string title, shortTitle;
    for (int j = 0; pi.title[j] != 0 && j < 128; ++j) title += static_cast<char>(pi.title[j]);
    for (int j = 0; pi.shortTitle[j] != 0 && j < 128; ++j) shortTitle += static_cast<char>(pi.shortTitle[j]);
    Napi::Object o = Napi::Object::New(env);
    o.Set("id", Napi::Number::New(env, pi.id));
    o.Set("title", Napi::String::New(env, title));
    o.Set("shortTitle", Napi::String::New(env, shortTitle));
    o.Set("defaultNormalizedValue", Napi::Number::New(env, pi.defaultNormalizedValue));
    o.Set("isBypass", Napi::Boolean::New(env, (pi.flags & ParameterInfo::kIsBypass) != 0));
    o.Set("canAutomate", Napi::Boolean::New(env, (pi.flags & ParameterInfo::kCanAutomate) != 0));
    o.Set("isReadOnly", Napi::Boolean::New(env, (pi.flags & ParameterInfo::kIsReadOnly) != 0));
    o.Set("stepCount", Napi::Number::New(env, pi.stepCount));
    arr.Set(static_cast<uint32_t>(i), o);
  }

  if (componentCP && controllerCP) {
    componentCP->disconnect(controllerCP.get());
    controllerCP->disconnect(componentCP.get());
  }
  controller->terminate();
  terminateComponent();
  return arr;
}

// De-hum's own GUI (screenshotted 2026-09-25) says "Click Learn to begin listening to the audio
// for hum" — its process() was never expected to reduce anything without that step, independent
// of every other RX11 finding in this investigation. ListPluginParams (above) found the real
// control: id 0, "Enable learning", a plain boolean automatable parameter (not exposed as
// kIsBypass or anything special) — Gaël's fix, implemented faithfully: toggle it 0->1 (start
// listening) while feeding real hum content, hold it a while so there's something to learn, then
// 1->0 (commit the learned reduction) — all as real IParameterChanges automation on ONE
// continuous plugin instance/stream (a fresh instance per run, like ProcessParamDiffTest uses,
// would discard whatever "Enable learning" ever taught it). Then keeps streaming the same
// stationary hum content and toggles the real "Global bypass" mid-stream, comparing RMS of the
// post-learn "active" region against the "bypassed" region of the SAME continuous run — a
// sample-position diff doesn't make sense here since bypass toggles mid-stream, not two separate
// runs from a cold instance, so RMS-of-region is the honest comparison, not
// maxAbsDiffBetweenRuns.
Napi::Value ProcessDehumLearnTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processDehumLearnTest(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  for (const auto& ci : factory.classInfos()) {
    if (ci.category() == std::string(kVstAudioEffectClass)) {
      audioClassId = ci.ID();
      foundAudioClass = true;
      break;
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };
  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController").ThrowAsJavaScriptException();
    return env.Null();
  }

  ParamID bypassParamId = 0;
  ParamID learnParamId = 0;
  bool foundBypass = false, foundLearn = false;
  {
    int32 count = controller->getParameterCount();
    for (int32 i = 0; i < count; ++i) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      if (pi.flags & ParameterInfo::kIsBypass) {
        bypassParamId = pi.id;
        foundBypass = true;
      }
      std::string title;
      for (int j = 0; pi.title[j] != 0 && j < 128; ++j) title += static_cast<char>(pi.title[j]);
      std::string lower = title;
      std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
      if (!foundLearn && lower.find("learn") != std::string::npos && lower.find("adaptive") == std::string::npos) {
        learnParamId = pi.id;
        foundLearn = true;
      }
    }
  }
  if (!foundBypass || !foundLearn) {
    terminateController();
    terminateComponent();
    Napi::Object result = Napi::Object::New(env);
    result.Set("foundBypass", Napi::Boolean::New(env, foundBypass));
    result.Set("foundLearn", Napi::Boolean::New(env, foundLearn));
    return result;
  }

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1 ||
      component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
      component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no usable main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }
  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;
  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;
  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };
  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  processor->setProcessing(true);

  constexpr double kPi = 3.14159265358979323846;
  // Stationary hum content: a steady 220Hz "program" tone plus a real 60Hz hum component at
  // meaningful amplitude, present in every block throughout, the way an actual noisy recording
  // would carry a constant mains hum under the material — De-hum has nothing to learn from a
  // clean tone.
  auto fillHummy = [&](float* buf, int32 n, int32 blockIndex) {
    for (int32 i = 0; i < n; ++i) {
      double t = static_cast<double>(blockIndex * blockSize + i) / sampleRate;
      buf[i] = 0.25f * static_cast<float>(std::sin(2.0 * kPi * 220.0 * t))
             + 0.25f * static_cast<float>(std::sin(2.0 * kPi * 60.0 * t));
    }
  };

  // Phase plan, all in one continuous stream on one instance:
  //   blocks [0, learnBlocks)        : learn=1, bypass=0 — "listening"
  //   block  learnBlocks             : learn 1->0 sent    — "stop learning, apply reduction"
  //   blocks [learnBlocks, +measureBlocks) : bypass=0 — measure RMS as "active, post-learn"
  //   block  at start of next phase  : bypass 0->1 sent   — "engage bypass"
  //   blocks [.., +measureBlocks)    : bypass=1 — measure RMS as "bypassed" (control)
  const int32 learnBlocks = 200;    // ~2.3s of listening
  const int32 measureBlocks = 100;  // ~1.16s each, for both the active and bypassed regions

  double activeSumSq = 0.0;
  int32 activeSamples = 0;
  double bypassedSumSq = 0.0;
  int32 bypassedSamples = 0;

  int32 totalBlocks = learnBlocks + 1 + measureBlocks + measureBlocks;
  for (int32 b = 0; b < totalBlocks; ++b) {
    HostProcessData pd;
    pd.prepare(*component, blockSize, kSample32);
    if (pd.numInputs > 0) {
      for (int32 ch = 0; ch < pd.inputs[0].numChannels; ++ch) {
        float* buf = pd.inputs[0].channelBuffers32[ch];
        if (buf) fillHummy(buf, blockSize, b);
      }
    }

    ParameterChanges changes;
    bool anyChange = false;
    IParamValueQueue* q = nullptr;
    int32 qIdx = 0;
    if (b == 0) {
      q = changes.addParameterData(learnParamId, qIdx);
      if (q) {
        int32 pIdx = 0;
        q->addPoint(0, 1.0, pIdx);
        anyChange = true;
      }
    } else if (b == learnBlocks) {
      q = changes.addParameterData(learnParamId, qIdx);
      if (q) {
        int32 pIdx = 0;
        q->addPoint(0, 0.0, pIdx);
        anyChange = true;
      }
    } else if (b == learnBlocks + 1 + measureBlocks) {
      q = changes.addParameterData(bypassParamId, qIdx);
      if (q) {
        int32 pIdx = 0;
        q->addPoint(0, 1.0, pIdx);
        anyChange = true;
      }
    }

    ProcessContext ctx{};
    ctx.sampleRate = sampleRate;
    ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
    ctx.tempo = 120.0;
    ctx.timeSigNumerator = 4;
    ctx.timeSigDenominator = 4;
    ctx.projectTimeSamples = static_cast<TSamples>(b) * blockSize;
    pd.processContext = &ctx;
    pd.numSamples = blockSize;
    if (anyChange) pd.inputParameterChanges = &changes;

    processor->process(pd);

    bool inActiveWindow = b >= learnBlocks + 1 && b < learnBlocks + 1 + measureBlocks;
    bool inBypassedWindow = b >= learnBlocks + 1 + measureBlocks;
    if ((inActiveWindow || inBypassedWindow) && pd.numOutputs > 0 && pd.outputs[0].numChannels > 0) {
      BufferStats st = ComputeStats(pd.outputs[0], blockSize);
      if (inActiveWindow) {
        activeSumSq += st.rms * st.rms * st.sampleCount;
        activeSamples += st.sampleCount;
      } else {
        bypassedSumSq += st.rms * st.rms * st.sampleCount;
        bypassedSamples += st.sampleCount;
      }
    }
  }

  double activeRms = activeSamples > 0 ? std::sqrt(activeSumSq / activeSamples) : 0.0;
  double bypassedRms = bypassedSamples > 0 ? std::sqrt(bypassedSumSq / bypassedSamples) : 0.0;

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("foundBypass", Napi::Boolean::New(env, foundBypass));
  result.Set("foundLearn", Napi::Boolean::New(env, foundLearn));
  result.Set("activeRmsPostLearn", Napi::Number::New(env, activeRms));
  result.Set("bypassedRms", Napi::Number::New(env, bypassedRms));
  result.Set("rmsDelta", Napi::Number::New(env, bypassedRms - activeRms));
  return result;
}

// DIAGNOSTIC ONLY — not part of the real hosting path, not exported to the shipped
// window.rhymixNative surface. Generalizes ProcessDehumLearnTest's proven pattern to the 4
// remaining unexplained RX 11 plugins (Breath Control, Dialogue Isolate, Guitar De-noise, Repair
// Assistant): scan for a Learn-like boolean parameter the same way De-hum's was found; if none
// exists, fall back to pushing the most plausible continuous Amount/Strength/Sensitivity/
// Threshold-style parameter to a clearly non-default value instead. Also accounts for the
// plugin's own reported IAudioProcessor::getLatencySamples() by inserting a settle gap (enough
// blocks to flush that much lookahead) after every parameter-changing event before RMS
// measurement starts — De-click/De-clip/De-crackle were wrongly written off as broken before this
// exact accounting was added in the previous pass (commit 9811f93); not repeating that mistake
// here. signalKind selects a per-plugin-appropriate test signal (0=breath bursts alternating with
// near-silence for Breath Control, 1=continuous tone+broadband hiss for Guitar De-noise,
// 2=voice-like tonal bursts over background noise for Dialogue Isolate/Repair Assistant).
Napi::Value ProcessLearnLikeToggleTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "processLearnLikeToggleTest(path: string, signalKind: number) expects those").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  int32 signalKind = info[1].As<Napi::Number>().Int32Value();
  // Optional explicit override, for multi-module plugins (Guitar De-noise, Repair Assistant) where
  // the auto keyword search picks the wrong knob among many similarly-named per-module ones —
  // (explicitParamId: number, explicitParamValue: number [, explicitBypassId: number]).
  bool hasExplicitAmount = info.Length() >= 4 && info[2].IsNumber() && info[3].IsNumber();
  ParamID explicitAmountId = hasExplicitAmount ? static_cast<ParamID>(info[2].As<Napi::Number>().Int64Value()) : 0;
  double explicitAmountValue = hasExplicitAmount ? info[3].As<Napi::Number>().DoubleValue() : 0.0;
  bool hasExplicitBypass = info.Length() >= 5 && info[4].IsNumber();
  ParamID explicitBypassId = hasExplicitBypass ? static_cast<ParamID>(info[4].As<Napi::Number>().Int64Value()) : 0;
  // A second knob to set at block 0 alongside the main one — needed for plugins with an
  // independent per-module bypass (e.g. Guitar De-noise's "AMP: Bypass", disabled by default,
  // separate from the amount/sensitivity knob within that same module).
  bool hasSecondary = info.Length() >= 7 && info[5].IsNumber() && info[6].IsNumber();
  ParamID secondaryParamId = hasSecondary ? static_cast<ParamID>(info[5].As<Napi::Number>().Int64Value()) : 0;
  double secondaryParamValue = hasSecondary ? info[6].As<Napi::Number>().DoubleValue() : 0.0;
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  for (const auto& ci : factory.classInfos()) {
    if (ci.category() == std::string(kVstAudioEffectClass)) {
      audioClassId = ci.ID();
      foundAudioClass = true;
      break;
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };
  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController").ThrowAsJavaScriptException();
    return env.Null();
  }

  ParamID bypassParamId = 0;
  ParamID learnParamId = 0;
  ParamID amountParamId = 0;
  double amountTargetValue = 0.9;
  bool foundBypass = false, foundLearn = false, foundAmount = false;
  std::string learnTitle, amountTitle;
  {
    static const char* kLearnWords[] = {"learn", "detect", "calibrate", "listen", "capture", "profile", "sample"};
    static const char* kAmountWords[] = {"amount", "strength", "sensitivity", "threshold", "reduction", "aggress", "depth"};
    int32 count = controller->getParameterCount();
    for (int32 i = 0; i < count; ++i) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      if (pi.flags & ParameterInfo::kIsBypass) {
        bypassParamId = pi.id;
        foundBypass = true;
        continue;
      }
      if (pi.flags & ParameterInfo::kIsReadOnly) continue;
      std::string title;
      for (int j = 0; pi.title[j] != 0 && j < 128; ++j) title += static_cast<char>(pi.title[j]);
      std::string lower = title;
      std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
      if (!foundLearn) {
        for (const char* w : kLearnWords) {
          if (lower.find(w) != std::string::npos && lower.find("adaptive") == std::string::npos) {
            learnParamId = pi.id;
            learnTitle = title;
            foundLearn = true;
            break;
          }
        }
      }
      if (!foundAmount) {
        for (const char* w : kAmountWords) {
          if (lower.find(w) != std::string::npos) {
            amountParamId = pi.id;
            amountTitle = title;
            foundAmount = true;
            break;
          }
        }
      }
    }
  }

  // Explicit override wins over the keyword search entirely — needed for multi-module plugins
  // (Guitar De-noise's SQUEAK/PICK/AMP sub-bypasses, Repair Assistant's per-module bypass+amount
  // pairs) where several similarly-named parameters exist and the generic "first match" heuristic
  // above picks a knob that isn't the one actually gating the DSP an appropriate test signal would
  // exercise.
  if (hasExplicitAmount) {
    amountParamId = explicitAmountId;
    amountTargetValue = explicitAmountValue;
    foundAmount = true;
    foundLearn = false;  // an explicit override means "we know exactly which knob", skip Learn search
    amountTitle = "(explicit override)";
  }
  if (hasExplicitBypass) {
    bypassParamId = explicitBypassId;
    foundBypass = true;
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("foundBypass", Napi::Boolean::New(env, foundBypass));
  result.Set("foundLearn", Napi::Boolean::New(env, foundLearn));
  result.Set("learnTitle", Napi::String::New(env, learnTitle));
  result.Set("foundAmount", Napi::Boolean::New(env, foundAmount));
  result.Set("amountTitle", Napi::String::New(env, amountTitle));

  if (!foundBypass || (!foundLearn && !foundAmount)) {
    terminateController();
    terminateComponent();
    result.Set("ran", Napi::Boolean::New(env, false));
    return result;
  }

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1 ||
      component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
      component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no usable main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }
  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;
  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;
  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };
  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  int32 latencySamples = static_cast<int32>(processor->getLatencySamples());
  result.Set("latencySamples", Napi::Number::New(env, latencySamples));
  int32 settleBlocks = (latencySamples + blockSize - 1) / blockSize;

  processor->setProcessing(true);

  constexpr double kPi = 3.14159265358979323846;
  auto pseudoNoise = [kPi](double t) {
    return 0.15 * std::sin(2 * kPi * 3371.0 * t) + 0.15 * std::sin(2 * kPi * 5417.0 * t)
         + 0.15 * std::sin(2 * kPi * 7919.0 * t) + 0.15 * std::sin(2 * kPi * 9973.0 * t)
         + 0.15 * std::sin(2 * kPi * 13417.0 * t) + 0.15 * std::sin(2 * kPi * 17389.0 * t);
  };
  auto fillSignal = [&](float* buf, int32 n, int32 blockIndex) {
    for (int32 i = 0; i < n; ++i) {
      double t = static_cast<double>(blockIndex * blockSize + i) / sampleRate;
      double v = 0.0;
      if (signalKind == 0) {
        // Breath Control: breathy noise burst alternating with near-silence, like real vocal
        // takes' breaths between phrases.
        double cyclePos = std::fmod(t, 1.0);
        if (cyclePos < 0.4) {
          double envelope = std::sin(kPi * cyclePos / 0.4);
          v = 0.3 * envelope * pseudoNoise(t);
        } else {
          v = 0.005 * pseudoNoise(t);
        }
      } else if (signalKind == 1) {
        // Guitar De-noise: a played note plus a constant broadband noise floor (amp hiss).
        v = 0.25 * std::sin(2 * kPi * 110.0 * t) + 0.08 * pseudoNoise(t);
      } else {
        // Dialogue Isolate / Repair Assistant: voice-like tonal bursts over background noise.
        double cyclePos = std::fmod(t, 1.2);
        double voice = 0.0;
        if (cyclePos < 0.7) {
          voice = 0.2 * std::sin(2 * kPi * 150.0 * t) + 0.1 * std::sin(2 * kPi * 300.0 * t)
                + 0.05 * std::sin(2 * kPi * 450.0 * t);
        }
        v = voice + 0.05 * pseudoNoise(t);
      }
      buf[i] = static_cast<float>(v);
    }
  };

  const int32 primeBlocks = 200;     // ~2.3s of real content before touching any parameter
  const int32 measureBlocks = 100;   // ~1.16s per measurement window

  double activeSumSq = 0.0;
  int32 activeSamples = 0;
  double bypassedSumSq = 0.0;
  int32 bypassedSamples = 0;

  // Phase plan, one continuous stream on one instance (matches ProcessDehumLearnTest — a fresh
  // instance per run would discard whatever a Learn step ever captured):
  //   [0, primeBlocks)                         : real content, whichever fallback param engaged at block 0
  //   primeBlocks                              : learn 1->0 sent (if a Learn param exists), else no-op
  //   [primeBlocks+1, +settleBlocks)           : settle gap, not measured (flush lookahead/finalize learn)
  //   [.. , +measureBlocks)                    : measured as "active"
  //   next block                               : bypass 0->1 sent
  //   [.., +settleBlocks)                      : settle gap, not measured
  //   [.., +measureBlocks)                     : measured as "bypassed" (control)
  int32 activeStart = primeBlocks + 1 + settleBlocks;
  int32 activeEnd = activeStart + measureBlocks;
  int32 bypassToggleBlock = activeEnd;
  int32 bypassedStart = bypassToggleBlock + 1 + settleBlocks;
  int32 bypassedEnd = bypassedStart + measureBlocks;
  int32 totalBlocks = bypassedEnd;

  for (int32 b = 0; b < totalBlocks; ++b) {
    HostProcessData pd;
    pd.prepare(*component, blockSize, kSample32);
    if (pd.numInputs > 0) {
      for (int32 ch = 0; ch < pd.inputs[0].numChannels; ++ch) {
        float* buf = pd.inputs[0].channelBuffers32[ch];
        if (buf) fillSignal(buf, blockSize, b);
      }
    }

    ParameterChanges changes;
    bool anyChange = false;
    int32 qIdx = 0;
    if (b == 0) {
      if (foundLearn) {
        IParamValueQueue* q = changes.addParameterData(learnParamId, qIdx);
        if (q) {
          int32 pIdx = 0;
          q->addPoint(0, 1.0, pIdx);
          anyChange = true;
        }
      } else if (foundAmount) {
        IParamValueQueue* q = changes.addParameterData(amountParamId, qIdx);
        if (q) {
          int32 pIdx = 0;
          q->addPoint(0, amountTargetValue, pIdx);
          anyChange = true;
        }
        if (hasSecondary) {
          IParamValueQueue* q2 = changes.addParameterData(secondaryParamId, qIdx);
          if (q2) {
            int32 pIdx2 = 0;
            q2->addPoint(0, secondaryParamValue, pIdx2);
            anyChange = true;
          }
        }
      }
    } else if (b == primeBlocks && foundLearn) {
      IParamValueQueue* q = changes.addParameterData(learnParamId, qIdx);
      if (q) {
        int32 pIdx = 0;
        q->addPoint(0, 0.0, pIdx);
        anyChange = true;
      }
    } else if (b == bypassToggleBlock) {
      IParamValueQueue* q = changes.addParameterData(bypassParamId, qIdx);
      if (q) {
        int32 pIdx = 0;
        q->addPoint(0, 1.0, pIdx);
        anyChange = true;
      }
    }

    ProcessContext ctx{};
    ctx.sampleRate = sampleRate;
    ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
    ctx.tempo = 120.0;
    ctx.timeSigNumerator = 4;
    ctx.timeSigDenominator = 4;
    ctx.projectTimeSamples = static_cast<TSamples>(b) * blockSize;
    pd.processContext = &ctx;
    pd.numSamples = blockSize;
    if (anyChange) pd.inputParameterChanges = &changes;

    processor->process(pd);

    bool inActiveWindow = b >= activeStart && b < activeEnd;
    bool inBypassedWindow = b >= bypassedStart && b < bypassedEnd;
    if ((inActiveWindow || inBypassedWindow) && pd.numOutputs > 0 && pd.outputs[0].numChannels > 0) {
      BufferStats st = ComputeStats(pd.outputs[0], blockSize);
      if (inActiveWindow) {
        activeSumSq += st.rms * st.rms * st.sampleCount;
        activeSamples += st.sampleCount;
      } else {
        bypassedSumSq += st.rms * st.rms * st.sampleCount;
        bypassedSamples += st.sampleCount;
      }
    }
  }

  double activeRms = activeSamples > 0 ? std::sqrt(activeSumSq / activeSamples) : 0.0;
  double bypassedRms = bypassedSamples > 0 ? std::sqrt(bypassedSumSq / bypassedSamples) : 0.0;

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  result.Set("ran", Napi::Boolean::New(env, true));
  result.Set("usedFallbackAmount", Napi::Boolean::New(env, !foundLearn && foundAmount));
  result.Set("activeRms", Napi::Number::New(env, activeRms));
  result.Set("bypassedRms", Napi::Number::New(env, bypassedRms));
  result.Set("rmsDelta", Napi::Number::New(env, bypassedRms - activeRms));
  return result;
}

// DIAGNOSTIC ONLY — not part of the real hosting path, not exported to the shipped
// window.rhymixNative surface. Tests Gaël's theory (docs/RX11_VST3_INVESTIGATION.md, 2026-09-25
// addendum) that RX 11's silent bypass is commercial host-allowlisting/DRM plus a possibly-
// required ProcessContext, not (only) a missing RX Connect/standalone dependency. The default
// Steinberg::Vst::HostApplication example class (which every other function in this file uses
// unmodified) reports its name as the literal string "My VST3 HostApplication" — see
// hostclasses.cpp getName(). This subclass reports a caller-supplied name instead, so the same
// bypass-toggle decisive test from ProcessParamDiffTest above can be re-run under a spoofed
// identity and/or a fuller ProcessContext, to see if either changes anything.
class SpoofedHostApplication : public Steinberg::Vst::HostApplication {
 public:
  explicit SpoofedHostApplication(std::string name) : name_(std::move(name)) {}

  Steinberg::tresult PLUGIN_API getName(Steinberg::Vst::String128 name) override {
    return Steinberg::Vst::StringConvert::convert(name_, name) ? Steinberg::kResultTrue
                                                                : Steinberg::kInternalError;
  }

 private:
  std::string name_;
};

Napi::Value ProcessDrmTheoryTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsBoolean()) {
    Napi::TypeError::New(
        env, "processDrmTheoryTest(path: string, hostName: string, usePlayingContext: boolean, injectClick?: boolean) expects at least those three")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string hostName = info[1].As<Napi::String>().Utf8Value();
  bool usePlayingContext = info[2].As<Napi::Boolean>().Value();
  // Added after Test 1's GUI screenshots showed De-click reporting a live, sane-looking "0 clicks
  // repaired" counter with no error/license/connect message — the honest read is that a clean
  // 440Hz tone has nothing for an artifact-specific restoration tool (de-click, de-hum,
  // de-crackle...) to detect and correct, so identical bypassed-vs-active output may be the
  // CORRECT behavior of a genuinely working plugin on an unsuitable test signal, not proof it's
  // silently doing nothing. When true, stamps one full-scale single-sample impulse into the
  // middle of the block — an actual click a de-click algorithm has something to act on.
  bool injectClick = info.Length() >= 4 && info[3].IsBoolean() && info[3].As<Napi::Boolean>().Value();

  std::string errorDescription;
  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  // The one real difference from ProcessParamDiffTest: a caller-nameable host identity instead of
  // the fixed default. Everything else below deliberately mirrors that function's proven sequence
  // exactly, so a diff in outcome is attributable to the identity/context change, not to some
  // incidental difference in how the two tests set things up.
  SpoofedHostApplication hostApplication(hostName);
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController — this test needs one").ThrowAsJavaScriptException();
    return env.Null();
  }

  ParamID chosenParamId = 0;
  std::string chosenParamTitle;
  bool foundParam = false;
  bool isBypassParam = false;
  {
    int32 count = controller->getParameterCount();
    ParameterInfo fallbackInfo{};
    bool haveFallback = false;
    for (int32 i = 0; i < count; ++i) {
      ParameterInfo pi{};
      if (controller->getParameterInfo(i, pi) != kResultOk) continue;
      if (pi.flags & ParameterInfo::kIsBypass) {
        chosenParamId = pi.id;
        foundParam = true;
        isBypassParam = true;
        for (int j = 0; pi.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(pi.title[j]);
        break;
      }
      if (!haveFallback && (pi.flags & ParameterInfo::kCanAutomate) && !(pi.flags & ParameterInfo::kIsReadOnly)) {
        fallbackInfo = pi;
        haveFallback = true;
      }
    }
    if (!foundParam && haveFallback) {
      chosenParamId = fallbackInfo.id;
      foundParam = true;
      for (int j = 0; fallbackInfo.title[j] != 0 && j < 128; ++j) chosenParamTitle += static_cast<char>(fallbackInfo.title[j]);
    }
  }
  if (!foundParam) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "No automatable/bypass parameter found on this plugin's controller").ThrowAsJavaScriptException();
    return env.Null();
  }

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  BusInfo inBusInfo{};
  BusInfo outBusInfo{};
  if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1 ||
      component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
      component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no usable main audio bus").ThrowAsJavaScriptException();
    return env.Null();
  }

  SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  processor->setBusArrangements(&inArr, 1, &outArr, 1);
  component->getBusInfo(kAudio, kInput, 0, inBusInfo);
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;

  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  tresult setupResult = processor->setupProcessing(setup);
  if (setupResult != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  auto deactivateBuses = [&]() {
    component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
  };

  tresult activeResult = component->setActive(true);
  if (activeResult != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  tresult setProcessingResult = processor->setProcessing(true);  // non-fatal either way, reported below

  constexpr double kPi = 3.14159265358979323846;
  auto fillTone = [&](HostProcessData& pd) {
    if (pd.numInputs > 0) {
      for (int32 ch = 0; ch < pd.inputs[0].numChannels; ++ch) {
        float* buf = pd.inputs[0].channelBuffers32[ch];
        if (!buf) continue;
        for (int32 i = 0; i < blockSize; ++i) {
          buf[i] = 0.5f * static_cast<float>(std::sin(2.0 * kPi * 440.0 * static_cast<double>(i) / sampleRate));
        }
        if (injectClick) {
          buf[blockSize / 2] = 1.0f;      // one full-scale sample: a textbook single-sample click
          buf[blockSize / 2 + 1] = -1.0f; // and its opposite-polarity neighbor, for a sharp edge
        }
      }
    }
  };

  double valueA = isBypassParam ? 1.0 : 0.0;
  double valueB = isBypassParam ? 0.0 : 1.0;

  auto runOnce = [&](double paramValue, BufferStats& outStats, tresult& processResult) {
    HostProcessData pd;
    pd.prepare(*component, blockSize, kSample32);
    fillTone(pd);

    ParameterChanges changes;
    int32 idx = 0;
    IParamValueQueue* q = changes.addParameterData(chosenParamId, idx);
    if (q) {
      int32 pointIdx = 0;
      q->addPoint(0, paramValue, pointIdx);
    }

    // The one other real difference from ProcessParamDiffTest: optionally a fuller, "this project
    // is really playing" context instead of just a sample rate, per Gaël's ProcessContext theory.
    ProcessContext ctx{};
    ctx.sampleRate = sampleRate;
    if (usePlayingContext) {
      ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
      ctx.tempo = 120.0;
      ctx.timeSigNumerator = 4;
      ctx.timeSigDenominator = 4;
      ctx.projectTimeSamples = 0;
    }
    pd.processContext = &ctx;
    pd.numSamples = blockSize;
    pd.inputParameterChanges = &changes;

    processResult = processor->process(pd);
    outStats = pd.numOutputs > 0 ? ComputeStats(pd.outputs[0], blockSize) : BufferStats{};

    std::vector<float> raw;
    if (pd.numOutputs > 0 && pd.outputs[0].numChannels > 0 && pd.outputs[0].channelBuffers32[0]) {
      raw.assign(pd.outputs[0].channelBuffers32[0], pd.outputs[0].channelBuffers32[0] + blockSize);
    }
    return raw;
  };

  BufferStats statsA{}, statsB{};
  tresult processResultA = kResultFalse, processResultB = kResultFalse;
  std::vector<float> outputA = runOnce(valueA, statsA, processResultA);
  std::vector<float> outputB = runOnce(valueB, statsB, processResultB);

  double maxAbsDiffBetweenRuns = 0.0;
  bool comparable = outputA.size() == outputB.size() && !outputA.empty();
  if (comparable) {
    for (size_t i = 0; i < outputA.size(); ++i) {
      maxAbsDiffBetweenRuns = std::max(maxAbsDiffBetweenRuns, static_cast<double>(std::abs(outputA[i] - outputB[i])));
    }
  }

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("hostNameUsed", Napi::String::New(env, hostName));
  result.Set("usePlayingContext", Napi::Boolean::New(env, usePlayingContext));
  result.Set("setProcessingResult", Napi::Number::New(env, setProcessingResult));
  result.Set("paramId", Napi::Number::New(env, chosenParamId));
  result.Set("paramTitle", Napi::String::New(env, chosenParamTitle));
  result.Set("isBypassParam", Napi::Boolean::New(env, isBypassParam));
  result.Set("processResultA", Napi::Number::New(env, processResultA));
  result.Set("processResultB", Napi::Number::New(env, processResultB));
  result.Set("statsA", StatsToJs(env, statsA));
  result.Set("statsB", StatsToJs(env, statsB));
  result.Set("comparable", Napi::Boolean::New(env, comparable));
  result.Set("maxAbsDiffBetweenRuns", Napi::Number::New(env, maxAbsDiffBetweenRuns));
  return result;
}

// Instruments (Dexed, and synths generally) generate audio from MIDI events rather than
// processing an input audio signal — the "feed a tone, diff the output" model the two functions
// above use doesn't apply, and most declare zero audio input buses at all. Sends one real
// note-on through a real IEventList on processData.inputEvents (the actual VST3 event path, the
// same one Steinberg's own audiohost reference host uses — not a shortcut), then runs several
// consecutive blocks with no further input at all. Real audio coming out of an otherwise-fed-
// nothing output bus after a note-on is about as unambiguous a "real DSP happened" signal as this
// kind of test can produce: unlike the effects-plugin tests, there is no "correctly passed clean
// input through unchanged" escape hatch to rule out — a synth fed a held note and outputting
// silence would mean nothing is happening, full stop.
Napi::Value ProcessSynthTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "processSynthTest(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  // Instruments use the same "Audio Module Class" category as effects — VST3 distinguishes them
  // by subCategories string (e.g. "Instrument|Synth"), not a separate class category constant.
  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  bool hasSeparateController = false;
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    hasSeparateController = true;
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  FUnknownPtr<IAudioProcessor> processor(component.get());
  if (!processor) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Component does not implement IAudioProcessor").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Only the output side is required — instruments legitimately declare zero audio input buses.
  const int32 numOutputBuses = component->getBusCount(kAudio, kOutput);
  if (numOutputBuses < 1) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin has no audio output bus").ThrowAsJavaScriptException();
    return env.Null();
  }
  const int32 numInputBuses = component->getBusCount(kAudio, kInput);
  const int32 numEventInputBuses = component->getBusCount(kEvent, kInput);

  BusInfo outBusInfo{};
  if (component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->getBusInfo() failed for the main audio output bus").ThrowAsJavaScriptException();
    return env.Null();
  }

  SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
  if (numInputBuses > 0) {
    BusInfo inBusInfo{};
    component->getBusInfo(kAudio, kInput, 0, inBusInfo);
    SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
    processor->setBusArrangements(&inArr, 1, &outArr, 1);
  } else {
    processor->setBusArrangements(nullptr, 0, &outArr, 1);
  }
  component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

  const int32 blockSize = 512;
  const double sampleRate = 44100.0;

  ProcessSetup setup{};
  setup.processMode = kOffline;
  setup.symbolicSampleSize = kSample32;
  setup.maxSamplesPerBlock = blockSize;
  setup.sampleRate = sampleRate;

  if (processor->setupProcessing(setup) != kResultOk) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "processor->setupProcessing() failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (numInputBuses > 0) component->activateBus(kAudio, kInput, 0, true);
  component->activateBus(kAudio, kOutput, 0, true);
  if (numEventInputBuses > 0) component->activateBus(kEvent, kInput, 0, true);

  auto deactivateBuses = [&]() {
    if (numInputBuses > 0) component->activateBus(kAudio, kInput, 0, false);
    component->activateBus(kAudio, kOutput, 0, false);
    if (numEventInputBuses > 0) component->activateBus(kEvent, kInput, 0, false);
  };

  if (component->setActive(true) != kResultOk) {
    deactivateBuses();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "component->setActive(true) failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Non-fatal, same rationale as processAudioTest (see the forum link at the top of this file).
  tresult setProcessingResult = processor->setProcessing(true);

  const int32 numBlocks = 12;  // ~139ms at 44.1kHz/512 — enough for a fast attack envelope to open
  std::vector<BufferStats> perBlockStats;
  perBlockStats.reserve(numBlocks);
  double overallMin = std::numeric_limits<double>::infinity();
  double overallMax = -std::numeric_limits<double>::infinity();
  double sumSq = 0.0;
  int64_t totalSamples = 0;
  bool anyNonFinite = false;
  tresult firstProcessResult = kResultFalse;

  EventList eventList;
  for (int32 block = 0; block < numBlocks; ++block) {
    HostProcessData pd;
    pd.prepare(*component, blockSize, kSample32);

    ProcessContext ctx{};
    ctx.sampleRate = sampleRate;
    pd.processContext = &ctx;
    pd.numSamples = blockSize;

    if (block == 0 && numEventInputBuses > 0) {
      Event noteOn{};
      noteOn.busIndex = 0;
      noteOn.sampleOffset = 0;
      noteOn.ppqPosition = 0;
      noteOn.flags = Event::kIsLive;
      noteOn.type = Event::kNoteOnEvent;
      noteOn.noteOn.channel = 0;
      noteOn.noteOn.pitch = 60;  // Middle C
      noteOn.noteOn.tuning = 0.f;
      noteOn.noteOn.velocity = 0.9f;
      noteOn.noteOn.length = 0;
      noteOn.noteOn.noteId = -1;
      eventList.addEvent(noteOn);
      pd.inputEvents = &eventList;
    }

    tresult processResult = processor->process(pd);
    if (block == 0) firstProcessResult = processResult;

    if (pd.numOutputs > 0) {
      BufferStats stats = ComputeStats(pd.outputs[0], blockSize);
      perBlockStats.push_back(stats);
      if (!stats.allFinite) anyNonFinite = true;
      if (stats.sampleCount > 0) {
        overallMin = std::min(overallMin, stats.min);
        overallMax = std::max(overallMax, stats.max);
        sumSq += stats.rms * stats.rms * static_cast<double>(stats.sampleCount);
        totalSamples += stats.sampleCount;
      }
    }
  }

  processor->setProcessing(false);
  component->setActive(false);
  deactivateBuses();
  terminateController();
  terminateComponent();

  double overallRms = totalSamples > 0 ? std::sqrt(sumSq / static_cast<double>(totalSamples)) : 0.0;

  Napi::Object result = Napi::Object::New(env);
  result.Set("setProcessingResult", Napi::Number::New(env, setProcessingResult));
  result.Set("processResult", Napi::Number::New(env, firstProcessResult));
  result.Set("hasSeparateController", Napi::Boolean::New(env, hasSeparateController));
  result.Set("numOutputBuses", Napi::Number::New(env, numOutputBuses));
  result.Set("numInputBuses", Napi::Number::New(env, numInputBuses));
  result.Set("numEventInputBuses", Napi::Number::New(env, numEventInputBuses));
  result.Set("numBlocks", Napi::Number::New(env, numBlocks));
  result.Set("overallMin", Napi::Number::New(env, totalSamples > 0 ? overallMin : 0.0));
  result.Set("overallMax", Napi::Number::New(env, totalSamples > 0 ? overallMax : 0.0));
  result.Set("overallRms", Napi::Number::New(env, overallRms));
  result.Set("allFinite", Napi::Boolean::New(env, !anyNonFinite));

  Napi::Array perBlockArray = Napi::Array::New(env, static_cast<uint32_t>(perBlockStats.size()));
  for (size_t i = 0; i < perBlockStats.size(); ++i) {
    perBlockArray.Set(static_cast<uint32_t>(i), StatsToJs(env, perBlockStats[i]));
  }
  result.Set("perBlockStats", perBlockArray);

  return result;
}

// Minimal, dependency-free 24bpp BMP writer for a top-down BGR pixel buffer — avoids pulling in
// GDI+/WIC just to prove a window painted something. Returns false on file-open failure.
bool WriteBmp24(const std::string& path, int width, int height, const std::vector<uint8_t>& bgr) {
  const int rowSize = ((width * 3 + 3) / 4) * 4;  // BMP rows are padded to 4-byte boundaries
  const int dataSize = rowSize * height;
  const int fileSize = 54 + dataSize;

  std::ofstream f(path, std::ios::binary);
  if (!f) return false;

  uint8_t fileHeader[14] = {'B', 'M', 0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0};
  fileHeader[2] = static_cast<uint8_t>(fileSize);
  fileHeader[3] = static_cast<uint8_t>(fileSize >> 8);
  fileHeader[4] = static_cast<uint8_t>(fileSize >> 16);
  fileHeader[5] = static_cast<uint8_t>(fileSize >> 24);

  uint8_t infoHeader[40] = {0};
  infoHeader[0] = 40;
  auto putI32 = [&](uint8_t* dst, int32_t v) {
    dst[0] = static_cast<uint8_t>(v);
    dst[1] = static_cast<uint8_t>(v >> 8);
    dst[2] = static_cast<uint8_t>(v >> 16);
    dst[3] = static_cast<uint8_t>(v >> 24);
  };
  putI32(infoHeader + 4, width);
  putI32(infoHeader + 8, height);  // positive = bottom-up storage order, handled below
  infoHeader[12] = 1;   // planes
  infoHeader[14] = 24;  // bpp
  putI32(infoHeader + 20, dataSize);

  f.write(reinterpret_cast<char*>(fileHeader), 14);
  f.write(reinterpret_cast<char*>(infoHeader), 40);

  // bgr[] is stored top-down (row 0 = top); BMP with a positive height field expects bottom-up —
  // write rows in reverse.
  std::vector<uint8_t> padRow(rowSize, 0);
  for (int y = height - 1; y >= 0; --y) {
    const uint8_t* rowSrc = bgr.data() + static_cast<size_t>(y) * width * 3;
    std::copy(rowSrc, rowSrc + width * 3, padRow.begin());
    f.write(reinterpret_cast<char*>(padRow.data()), rowSize);
  }
  return f.good();
}

// GUI window embedding: gets a plugin's own editor to actually paint into a real Win32 window
// this host owns, and proves it with a real captured screenshot — not just "attached() didn't
// return an error". Requires the Controller/IConnectionPoint bridge (same as processAudioTest)
// since a plugin's editor talks to its Controller, not the Component.
Napi::Value ProcessGuiTest(const Napi::CallbackInfo& info) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "processGuiTest(path: string, screenshotPath: string) expects two strings")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  std::string screenshotPath = info[1].As<Napi::String>().Utf8Value();
  std::string errorDescription;

  Module::Ptr module = Module::create(path, errorDescription);
  if (!module) {
    Napi::Error::New(env, "Failed to load VST3 module: " + errorDescription).ThrowAsJavaScriptException();
    return env.Null();
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    Napi::Error::New(env, "No Audio Module Class found in this plugin").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    Napi::Error::New(env, "component create/initialize failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  if (!controller) {
    terminateComponent();
    Napi::Error::New(env, "Plugin has no separate EditController — GUI test needs one").ThrowAsJavaScriptException();
    return env.Null();
  }

  IPlugView* view = controller->createView(ViewType::kEditor);
  if (!view) {
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "controller->createView(kEditor) returned null").ThrowAsJavaScriptException();
    return env.Null();
  }

  bool platformSupported = view->isPlatformTypeSupported(kPlatformTypeHWND) == kResultTrue;
  if (!platformSupported) {
    view->release();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "Plugin editor does not support kPlatformTypeHWND").ThrowAsJavaScriptException();
    return env.Null();
  }

  // A plain top-level window — this proves the plugin can paint into a window this host owns,
  // not the final embedded-in-the-Rhymix-shell UX (a separate, later step).
  static const wchar_t* kClassName = L"RhymixVst3GuiTestWindow";
  WNDCLASSW wc{};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = kClassName;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  // RegisterClassW fails harmlessly if already registered from a previous run in this process
  // (the "run twice" check) — ignore that specific case, surface anything else.
  RegisterClassW(&wc);

  HWND hwnd = CreateWindowExW(0, kClassName, L"Rhymix VST3 GUI test", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT,
                               CW_USEDEFAULT, 800, 600, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!hwnd) {
    view->release();
    terminateController();
    terminateComponent();
    Napi::Error::New(env, "CreateWindowExW failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto pumpMessages = [](int milliseconds) {
    DWORD until = GetTickCount() + static_cast<DWORD>(milliseconds);
    MSG msg;
    while (static_cast<int32_t>(until - GetTickCount()) > 0) {
      while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
      }
      Sleep(10);
    }
  };

  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);
  pumpMessages(200);  // let the bare window paint once before attaching, for a cleaner delta

  tresult attachResult = view->attached(hwnd, kPlatformTypeHWND);

  ViewRect rect{};
  bool gotSize = view->getSize(&rect) == kResultOk;
  int32_t reportedWidth = gotSize ? (rect.right - rect.left) : 0;
  int32_t reportedHeight = gotSize ? (rect.bottom - rect.top) : 0;

  if (gotSize && reportedWidth > 0 && reportedHeight > 0) {
    RECT wr{0, 0, reportedWidth, reportedHeight};
    AdjustWindowRect(&wr, WS_OVERLAPPEDWINDOW, FALSE);
    SetWindowPos(hwnd, nullptr, 0, 0, wr.right - wr.left, wr.bottom - wr.top,
                 SWP_NOMOVE | SWP_NOZORDER);
    view->onSize(&rect);
  }

  // Real time for the editor to actually paint — VST GUIs commonly redraw on a timer, not just
  // once synchronously inside attached().
  pumpMessages(1500);

  // Capture via PrintWindow into a DIB section so the pixel buffer is directly readable (not
  // just "a bitmap exists somewhere in GDI") — PW_RENDERFULLCONTENT (Windows 8.1+) is required
  // for windows using modern composited rendering, not just classic GDI painting.
  RECT clientRect{};
  GetClientRect(hwnd, &clientRect);
  int captureWidth = clientRect.right - clientRect.left;
  int captureHeight = clientRect.bottom - clientRect.top;

  bool screenshotWritten = false;
  bool pixelsVaried = false;
  int32_t distinctSampledPixels = 0;

  if (captureWidth > 0 && captureHeight > 0) {
    // Capture from the DESKTOP DC at the window's real on-screen rectangle, not PrintWindow/
    // BitBlt against the window's own DC. Plugin GUI frameworks (JUCE, which Dexed is built
    // with, among others) commonly render through an OpenGL/GPU-composited swap chain rather
    // than classic GDI painting — PrintWindow(..., PW_RENDERFULLCONTENT) and a window-DC BitBlt
    // both read back solid black for that case (confirmed: an earlier version of this function
    // did exactly that and produced a byte-for-byte uniform black 866x674 image, verified with
    // PIL's getcolors() reporting exactly 1 distinct color across the whole bitmap — not a
    // sampling artifact). The desktop DC instead reads whatever DWM actually composited to the
    // physical screen, which includes GPU-rendered content, because that's the real final pixel
    // data a person looking at the monitor would see.
    SetForegroundWindow(hwnd);
    pumpMessages(200);
    RECT screenRect{};
    GetWindowRect(hwnd, &screenRect);

    HDC hdcScreen = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);

    BITMAPINFO bmi{};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = captureWidth;
    bmi.bmiHeader.biHeight = -captureHeight;  // negative = top-down DIB, matches our BMP writer's row order
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 24;
    bmi.bmiHeader.biCompression = BI_RGB;

    void* dibBits = nullptr;
    HBITMAP hBitmap = CreateDIBSection(hdcScreen, &bmi, DIB_RGB_COLORS, &dibBits, nullptr, 0);
    if (hBitmap && dibBits) {
      HBITMAP oldBitmap = static_cast<HBITMAP>(SelectObject(hdcMem, hBitmap));

      // clientRect's origin is window-relative; convert the client area's top-left to screen
      // coordinates so the blit source lines up with the client-sized destination bitmap exactly
      // (screenRect is the OUTER window rect, including title bar/borders — using it directly
      // would offset the capture by the window chrome).
      POINT clientOriginScreen{0, 0};
      ClientToScreen(hwnd, &clientOriginScreen);
      BitBlt(hdcMem, 0, 0, captureWidth, captureHeight, hdcScreen, clientOriginScreen.x, clientOriginScreen.y,
             SRCCOPY);
      GdiFlush();

      const int rowSize = ((captureWidth * 3 + 3) / 4) * 4;
      std::vector<uint8_t> bgr(static_cast<size_t>(captureWidth) * captureHeight * 3);
      const uint8_t* src = static_cast<const uint8_t*>(dibBits);
      for (int y = 0; y < captureHeight; ++y) {
        std::copy(src + static_cast<size_t>(y) * rowSize, src + static_cast<size_t>(y) * rowSize + captureWidth * 3,
                   bgr.begin() + static_cast<size_t>(y) * captureWidth * 3);
      }

      // Sanity check: sample a grid of pixels and confirm they aren't all identical (a blank/
      // black/uniform-color window would fail this) — cheap, no need to hash the whole buffer.
      if (!bgr.empty()) {
        uint8_t first[3] = {bgr[0], bgr[1], bgr[2]};
        std::vector<uint8_t> seenR, seenG, seenB;
        const int stepX = std::max(1, captureWidth / 40);
        const int stepY = std::max(1, captureHeight / 40);
        for (int y = 0; y < captureHeight; y += stepY) {
          for (int x = 0; x < captureWidth; x += stepX) {
            size_t idx = (static_cast<size_t>(y) * captureWidth + x) * 3;
            if (bgr[idx] != first[0] || bgr[idx + 1] != first[1] || bgr[idx + 2] != first[2]) {
              pixelsVaried = true;
            }
            distinctSampledPixels++;
          }
        }
      }

      screenshotWritten = WriteBmp24(screenshotPath, captureWidth, captureHeight, bgr);

      SelectObject(hdcMem, oldBitmap);
      DeleteObject(hBitmap);
    }
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScreen);
  }

  view->removed();
  view->release();
  DestroyWindow(hwnd);
  terminateController();
  terminateComponent();

  Napi::Object result = Napi::Object::New(env);
  result.Set("platformSupported", Napi::Boolean::New(env, platformSupported));
  result.Set("attachResult", Napi::Number::New(env, attachResult));
  result.Set("attachOk", Napi::Boolean::New(env, attachResult == kResultOk));
  result.Set("gotSize", Napi::Boolean::New(env, gotSize));
  result.Set("reportedWidth", Napi::Number::New(env, reportedWidth));
  result.Set("reportedHeight", Napi::Number::New(env, reportedHeight));
  result.Set("captureWidth", Napi::Number::New(env, captureWidth));
  result.Set("captureHeight", Napi::Number::New(env, captureHeight));
  result.Set("screenshotWritten", Napi::Boolean::New(env, screenshotWritten));
  result.Set("screenshotPath", Napi::String::New(env, screenshotPath));
  result.Set("pixelsVaried", Napi::Boolean::New(env, pixelsVaried));
  result.Set("distinctSampledPixels", Napi::Number::New(env, distinctSampledPixels));
  return result;
}

// -------------------------------------------------------------------------------------------
// Offline file rendering: renderAudioFile(pluginPath, inputWavPath, outputWavPath).
//
// Everything above this point processes one synthetic in-memory block and discards the result.
// This is the first feature that does something with a real file: read a real WAV, run every
// block of it through a loaded plugin's process(), write a real WAV back out. Explicitly
// OFFLINE/one-shot — not a live playback route into the app's Web Audio graph, which is a
// separate real-time-systems project (shared memory, a dedicated audio thread, sample-accurate
// sync) not attempted here.
// -------------------------------------------------------------------------------------------

struct WavAudio {
  double sampleRate = 0.0;
  int32_t numChannels = 0;
  int32_t numFrames = 0;
  std::vector<float> interleaved;  // numFrames * numChannels, range roughly [-1, 1]
};

// Minimal RIFF/WAVE reader. Supports the two formats this project's own exports and most real
// tools actually produce: 16-bit PCM (ffmpeg's default .wav codec, confirmed against
// backend/features/studio/render.py, which sets no explicit -acodec) and 32-bit IEEE float.
// Also tolerates 24-bit and 32-bit integer PCM since they're common enough elsewhere. Chunks
// other than "fmt " and "data" (e.g. "LIST", "fact") are skipped, not assumed absent.
bool ReadWavFile(const std::string& path, WavAudio& out, std::string& err) {
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    err = "cannot open file: " + path;
    return false;
  }

  char riffId[4], waveId[4];
  uint32_t riffSize = 0;
  f.read(riffId, 4);
  f.read(reinterpret_cast<char*>(&riffSize), 4);
  f.read(waveId, 4);
  if (!f || std::memcmp(riffId, "RIFF", 4) != 0 || std::memcmp(waveId, "WAVE", 4) != 0) {
    err = "not a RIFF/WAVE file";
    return false;
  }

  uint16_t audioFormat = 0, numChannels = 0, bitsPerSample = 0;
  uint32_t sampleRate = 0;
  bool haveFmt = false;
  std::vector<uint8_t> dataBytes;
  bool haveData = false;

  while (f) {
    char chunkId[4];
    uint32_t chunkSize = 0;
    f.read(chunkId, 4);
    if (!f) break;
    f.read(reinterpret_cast<char*>(&chunkSize), 4);
    if (!f) break;

    if (std::memcmp(chunkId, "fmt ", 4) == 0) {
      std::vector<char> fmtBuf(chunkSize);
      f.read(fmtBuf.data(), chunkSize);
      if (chunkSize >= 16) {
        std::memcpy(&audioFormat, &fmtBuf[0], 2);
        std::memcpy(&numChannels, &fmtBuf[2], 2);
        std::memcpy(&sampleRate, &fmtBuf[4], 4);
        std::memcpy(&bitsPerSample, &fmtBuf[14], 2);
        haveFmt = true;
      }
    } else if (std::memcmp(chunkId, "data", 4) == 0) {
      dataBytes.resize(chunkSize);
      f.read(reinterpret_cast<char*>(dataBytes.data()), chunkSize);
      haveData = true;
    } else {
      f.seekg(chunkSize, std::ios::cur);
    }
    if (chunkSize % 2 == 1 && f) f.seekg(1, std::ios::cur);  // chunks are word-aligned
  }

  if (!haveFmt || !haveData) {
    err = "missing fmt or data chunk";
    return false;
  }
  if (numChannels < 1 || bitsPerSample == 0) {
    err = "invalid channel count or bit depth in fmt chunk";
    return false;
  }

  out.sampleRate = static_cast<double>(sampleRate);
  out.numChannels = numChannels;

  const int32_t bytesPerSample = bitsPerSample / 8;
  const int32_t frameSize = bytesPerSample * numChannels;
  out.numFrames = frameSize > 0 ? static_cast<int32_t>(dataBytes.size() / frameSize) : 0;
  out.interleaved.assign(static_cast<size_t>(out.numFrames) * numChannels, 0.0f);

  const uint8_t* p = dataBytes.data();
  const size_t totalSamples = static_cast<size_t>(out.numFrames) * numChannels;
  for (size_t i = 0; i < totalSamples; ++i) {
    if (audioFormat == 3 && bitsPerSample == 32) {  // IEEE float
      float v;
      std::memcpy(&v, p, 4);
      out.interleaved[i] = v;
      p += 4;
    } else if (audioFormat == 1 && bitsPerSample == 16) {  // PCM16
      int16_t v;
      std::memcpy(&v, p, 2);
      out.interleaved[i] = static_cast<float>(v) / 32768.0f;
      p += 2;
    } else if (audioFormat == 1 && bitsPerSample == 24) {  // PCM24, little-endian, sign-extended
      int32_t v = p[0] | (p[1] << 8) | (p[2] << 16);
      if (v & 0x800000) v |= static_cast<int32_t>(0xFF000000);
      out.interleaved[i] = static_cast<float>(v) / 8388608.0f;
      p += 3;
    } else if (audioFormat == 1 && bitsPerSample == 32) {  // PCM32
      int32_t v;
      std::memcpy(&v, p, 4);
      out.interleaved[i] = static_cast<float>(v) / 2147483648.0f;
      p += 4;
    } else {
      err = "unsupported WAV format (audioFormat=" + std::to_string(audioFormat) +
            ", bitsPerSample=" + std::to_string(bitsPerSample) + ")";
      return false;
    }
  }
  return true;
}

// Minimal RIFF/WAVE writer, always 32-bit IEEE float PCM — simplest option, no clipping/
// quantization surprises from picking a fixed integer format for arbitrary plugin output.
bool WriteWavFileFloat32(const std::string& path, double sampleRate, int32_t numChannels,
                          const std::vector<float>& interleaved, std::string& err) {
  std::ofstream f(path, std::ios::binary);
  if (!f) {
    err = "cannot open output file for writing: " + path;
    return false;
  }

  const uint32_t sr = static_cast<uint32_t>(sampleRate);
  const uint16_t bitsPerSample = 32;
  const uint16_t audioFormat = 3;  // IEEE float
  const uint16_t ch = static_cast<uint16_t>(numChannels);
  const uint16_t blockAlign = static_cast<uint16_t>(numChannels * (bitsPerSample / 8));
  const uint32_t byteRate = sr * blockAlign;
  const uint32_t dataSize = static_cast<uint32_t>(interleaved.size() * sizeof(float));
  const uint32_t fmtChunkSize = 16;
  const uint32_t riffSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);

  f.write("RIFF", 4);
  f.write(reinterpret_cast<const char*>(&riffSize), 4);
  f.write("WAVE", 4);
  f.write("fmt ", 4);
  f.write(reinterpret_cast<const char*>(&fmtChunkSize), 4);
  f.write(reinterpret_cast<const char*>(&audioFormat), 2);
  f.write(reinterpret_cast<const char*>(&ch), 2);
  f.write(reinterpret_cast<const char*>(&sr), 4);
  f.write(reinterpret_cast<const char*>(&byteRate), 4);
  f.write(reinterpret_cast<const char*>(&blockAlign), 2);
  f.write(reinterpret_cast<const char*>(&bitsPerSample), 2);
  f.write("data", 4);
  f.write(reinterpret_cast<const char*>(&dataSize), 4);
  if (!interleaved.empty()) {
    f.write(reinterpret_cast<const char*>(interleaved.data()), dataSize);
  }
  return f.good();
}

struct WholeFileStats {
  double min = std::numeric_limits<double>::infinity();
  double max = -std::numeric_limits<double>::infinity();
  double rms = 0.0;
  bool allFinite = true;
  int64_t sampleCount = 0;
};

WholeFileStats ComputeWholeFileStats(const std::vector<float>& interleaved) {
  WholeFileStats stats;
  double sumSq = 0.0;
  for (float v : interleaved) {
    if (!std::isfinite(v)) {
      stats.allFinite = false;
      continue;
    }
    stats.min = std::min(stats.min, static_cast<double>(v));
    stats.max = std::max(stats.max, static_cast<double>(v));
    sumSq += static_cast<double>(v) * static_cast<double>(v);
    stats.sampleCount++;
  }
  stats.rms = stats.sampleCount > 0 ? std::sqrt(sumSq / static_cast<double>(stats.sampleCount)) : 0.0;
  return stats;
}

Napi::Object WholeFileStatsToJs(Napi::Env env, const WholeFileStats& stats) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("min", Napi::Number::New(env, stats.sampleCount > 0 ? stats.min : 0.0));
  obj.Set("max", Napi::Number::New(env, stats.sampleCount > 0 ? stats.max : 0.0));
  obj.Set("rms", Napi::Number::New(env, stats.rms));
  obj.Set("allFinite", Napi::Boolean::New(env, stats.allFinite));
  obj.Set("sampleCount", Napi::Number::New(env, static_cast<double>(stats.sampleCount)));
  return obj;
}

class RenderAudioFileWorker : public Napi::AsyncWorker {
 public:
  RenderAudioFileWorker(Napi::Env env, std::string pluginPath, std::string inputPath, std::string outputPath)
      : Napi::AsyncWorker(env),
        pluginPath_(std::move(pluginPath)),
        inputPath_(std::move(inputPath)),
        outputPath_(std::move(outputPath)),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    using namespace Steinberg;
    using namespace Steinberg::Vst;

    WavAudio input;
    if (!ReadWavFile(inputPath_, input, errorMessage_)) {
      SetError(errorMessage_);
      return;
    }
    inputStats_ = ComputeWholeFileStats(input.interleaved);

    std::string moduleErr;
    Module::Ptr module = Module::create(pluginPath_, moduleErr);
    if (!module) {
      SetError("Failed to load VST3 module: " + moduleErr);
      return;
    }

    HostApplication hostApplication;
    const auto& factory = module->getFactory();
    factory.setHostContext(&hostApplication);

    VST3::UID audioClassId;
    bool foundAudioClass = false;
    {
      std::vector<ClassInfo> infos = factory.classInfos();
      for (const auto& ci : infos) {
        if (ci.category() == std::string(kVstAudioEffectClass)) {
          audioClassId = ci.ID();
          foundAudioClass = true;
          break;
        }
      }
    }
    if (!foundAudioClass) {
      SetError("No Audio Module Class found in this plugin");
      return;
    }

    IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
    if (!component || component->initialize(&hostApplication) != kResultOk) {
      SetError("component create/initialize failed");
      return;
    }
    auto terminateComponent = [&]() { component->terminate(); };

    // Same Controller/IConnectionPoint bridge as processAudioTest — see that function's comment
    // for why it's required for real commercial ("distributable") plugins.
    IPtr<IEditController> controller;
    FUnknownPtr<IConnectionPoint> componentCP;
    FUnknownPtr<IConnectionPoint> controllerCP;
    TUID controllerCID{};
    if (component->getControllerClassId(controllerCID) == kResultOk) {
      VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
      controller = factory.createInstance<IEditController>(controllerUID);
      if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
      if (controller) {
        componentCP = FUnknownPtr<IConnectionPoint>(component.get());
        controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
        if (componentCP && controllerCP) {
          componentCP->connect(controllerCP.get());
          controllerCP->connect(componentCP.get());
        }
        MemoryStream componentState;
        if (component->getState(&componentState) == kResultOk) {
          componentState.seek(0, IBStream::kIBSeekSet, nullptr);
          controller->setComponentState(&componentState);
        }
      }
    }
    auto terminateController = [&]() {
      if (!controller) return;
      if (componentCP && controllerCP) {
        componentCP->disconnect(controllerCP.get());
        controllerCP->disconnect(componentCP.get());
      }
      controller->terminate();
      controller = nullptr;
    };

    FUnknownPtr<IAudioProcessor> processor(component.get());
    if (!processor) {
      terminateController();
      terminateComponent();
      SetError("Component does not implement IAudioProcessor");
      return;
    }

    if (component->getBusCount(kAudio, kInput) < 1 || component->getBusCount(kAudio, kOutput) < 1) {
      terminateController();
      terminateComponent();
      SetError("Plugin has no main audio input/output bus");
      return;
    }

    BusInfo inBusInfo{};
    BusInfo outBusInfo{};
    if (component->getBusInfo(kAudio, kInput, 0, inBusInfo) != kResultOk ||
        component->getBusInfo(kAudio, kOutput, 0, outBusInfo) != kResultOk) {
      terminateController();
      terminateComponent();
      SetError("component->getBusInfo() failed for the main audio bus");
      return;
    }

    SpeakerArrangement inArr = inBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
    SpeakerArrangement outArr = outBusInfo.channelCount == 1 ? SpeakerArr::kMono : SpeakerArr::kStereo;
    processor->setBusArrangements(&inArr, 1, &outArr, 1);
    component->getBusInfo(kAudio, kInput, 0, inBusInfo);
    component->getBusInfo(kAudio, kOutput, 0, outBusInfo);

    const int32 blockSize = 512;
    // Negotiate at the INPUT FILE's real sample rate, not a hardcoded value — a plugin's
    // time-based parameters (like ADelay's delay length) are expressed in seconds/samples-at-
    // this-rate, so rendering a 48kHz file through a setup declared as 44.1kHz would silently
    // misrender the timing.
    const double sampleRate = input.sampleRate > 0 ? input.sampleRate : 44100.0;

    ProcessSetup setup{};
    setup.processMode = kOffline;
    setup.symbolicSampleSize = kSample32;
    setup.maxSamplesPerBlock = blockSize;
    setup.sampleRate = sampleRate;

    if (processor->setupProcessing(setup) != kResultOk) {
      terminateController();
      terminateComponent();
      SetError("processor->setupProcessing() failed");
      return;
    }

    component->activateBus(kAudio, kInput, 0, true);
    component->activateBus(kAudio, kOutput, 0, true);
    auto deactivateBuses = [&]() {
      component->activateBus(kAudio, kInput, 0, false);
      component->activateBus(kAudio, kOutput, 0, false);
    };

    if (component->setActive(true) != kResultOk) {
      deactivateBuses();
      terminateController();
      terminateComponent();
      SetError("component->setActive(true) failed");
      return;
    }

    // Non-fatal, same rationale as processAudioTest (see the forum link at the top of this
    // file) — recorded, not treated as blocking.
    setProcessingResult_ = processor->setProcessing(true);

    const int32 pluginInChannels = inBusInfo.channelCount;
    const int32 pluginOutChannels = outBusInfo.channelCount;
    const int32 wavChannels = input.numChannels;

    HostProcessData processData;
    processData.prepare(*component, blockSize, kSample32);
    // A minimal-but-real ProcessContext, not just a sample rate: some plugins gate tempo-synced
    // behavior (or, per docs/RX11_VST3_INVESTIGATION.md's 2026-09-25 addendum, possibly more)
    // behind checking these validity flags before trusting kPlaying/tempo/time-signature at all.
    // Tested against the RX 11 suite specifically and confirmed to change nothing there (see that
    // doc), but a real host reporting an unset/all-zero context to every plugin regardless of
    // this project's actual 120bpm 4/4 default was an honest gap independent of that result.
    // projectTimeSamples is kept accurate per block below, not just set once and left at 0.
    ProcessContext processContext{};
    processContext.sampleRate = sampleRate;
    processContext.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
    processContext.tempo = 120.0;
    processContext.timeSigNumerator = 4;
    processContext.timeSigDenominator = 4;
    processData.processContext = &processContext;

    std::vector<float> outputInterleaved;
    outputInterleaved.reserve(static_cast<size_t>(input.numFrames) * pluginOutChannels);

    bool anyProcessFailed = false;
    for (int32 frameOffset = 0; frameOffset < input.numFrames; frameOffset += blockSize) {
      const int32 framesThisBlock = std::min(blockSize, input.numFrames - frameOffset);

      // De-interleave this block into the plugin's input bus, adapting the channel count:
      // matching channel counts copy straight across; mono-file-into-stereo-bus duplicates;
      // multichannel-file-into-mono-bus averages. Not a general mixer — just enough to not
      // silently truncate or leave buffers full of stale data from the previous block.
      if (processData.numInputs > 0) {
        for (int32 ch = 0; ch < pluginInChannels; ++ch) {
          float* buf = processData.inputs[0].channelBuffers32[ch];
          if (!buf) continue;
          for (int32 i = 0; i < framesThisBlock; ++i) {
            const int32 frame = frameOffset + i;
            float sample = 0.0f;
            if (wavChannels == pluginInChannels) {
              sample = input.interleaved[static_cast<size_t>(frame) * wavChannels + ch];
            } else if (wavChannels == 1) {
              sample = input.interleaved[static_cast<size_t>(frame)];
            } else {
              double sum = 0.0;
              for (int32 wc = 0; wc < wavChannels; ++wc) {
                sum += input.interleaved[static_cast<size_t>(frame) * wavChannels + wc];
              }
              sample = static_cast<float>(sum / wavChannels);
            }
            buf[i] = sample;
          }
          for (int32 i = framesThisBlock; i < blockSize; ++i) buf[i] = 0.0f;  // zero the tail of a partial last block
        }
      }

      processData.numSamples = framesThisBlock;
      processContext.projectTimeSamples = frameOffset;
      tresult r = processor->process(processData);
      if (r != kResultOk) anyProcessFailed = true;

      if (processData.numOutputs > 0) {
        for (int32 i = 0; i < framesThisBlock; ++i) {
          for (int32 ch = 0; ch < pluginOutChannels; ++ch) {
            float* buf = processData.outputs[0].channelBuffers32[ch];
            outputInterleaved.push_back(buf ? buf[i] : 0.0f);
          }
        }
      }
    }

    outputStats_ = ComputeWholeFileStats(outputInterleaved);

    processor->setProcessing(false);
    component->setActive(false);
    deactivateBuses();
    terminateController();
    terminateComponent();

    if (anyProcessFailed) {
      SetError("processor->process() returned a non-OK result for at least one block");
      return;
    }

    std::string writeErr;
    if (!WriteWavFileFloat32(outputPath_, sampleRate, pluginOutChannels, outputInterleaved, writeErr)) {
      SetError(writeErr);
      return;
    }

    outSampleRate_ = sampleRate;
    outChannels_ = pluginOutChannels;
    durationSec_ = sampleRate > 0 ? static_cast<double>(input.numFrames) / sampleRate : 0.0;
    success_ = true;
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, success_));
    result.Set("outputPath", Napi::String::New(env, outputPath_));
    result.Set("durationSec", Napi::Number::New(env, durationSec_));
    result.Set("sampleRate", Napi::Number::New(env, outSampleRate_));
    result.Set("channels", Napi::Number::New(env, outChannels_));
    result.Set("setProcessingResult", Napi::Number::New(env, setProcessingResult_));
    result.Set("inputStats", WholeFileStatsToJs(env, inputStats_));
    result.Set("outputStats", WholeFileStatsToJs(env, outputStats_));
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  std::string pluginPath_, inputPath_, outputPath_;
  std::string errorMessage_;
  Napi::Promise::Deferred deferred_;

  bool success_ = false;
  double durationSec_ = 0.0;
  double outSampleRate_ = 0.0;
  int32_t outChannels_ = 0;
  Steinberg::tresult setProcessingResult_ = Steinberg::kResultFalse;
  WholeFileStats inputStats_;
  WholeFileStats outputStats_;
};

Napi::Value RenderAudioFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(env, "renderAudioFile(pluginPath, inputWavPath, outputWavPath) expects three strings")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto* worker = new RenderAudioFileWorker(
      env, info[0].As<Napi::String>().Utf8Value(), info[1].As<Napi::String>().Utf8Value(),
      info[2].As<Napi::String>().Utf8Value());
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

// -------------------------------------------------------------------------------------------
// Stateful plugin-instance API: scanPlugins / openPluginEditor / closePluginEditor.
//
// Everything above this point is one-shot: load, prove something, tear everything down,
// return — fine for proving a specific claim, but a real product UI needs to open a plugin's
// editor and leave it open and interactive while the rest of the app (and Node's own event
// loop) keeps running. Each open instance gets its own dedicated OS thread that owns its VST3
// objects, its window, and its Win32 message loop for the instance's whole lifetime: nothing
// here blocks Node's main thread, and no VST3 object is ever touched from a thread other than
// the one that created it (thread affinity a lot of plugin GUI code silently assumes — this
// wasn't a problem for the one-shot functions above since each of those only ever used a
// single thread for a single call anyway).
// -------------------------------------------------------------------------------------------

constexpr UINT WM_APP_CLOSE_EDITOR = WM_APP + 1;
constexpr UINT WM_APP_REPOSITION = WM_APP + 2;

// Minimal Steinberg::IPlugFrame implementation. Every prior open-editor code path (standalone
// and embedded alike) never gave the plugin a frame at all — view->setFrame() was simply never
// called. Reference hosts (REAPER, Cubase, etc.) always provide one before attached(); some
// plugin GUI toolkits (confirmed here: iZotope RX 11's, which stayed a solid black rectangle
// once reparented as a WS_CHILD) apparently rely on a valid IPlugFrame being present to finish
// setting up their rendering surface, even though nothing in the IPlugView contract makes that
// strictly mandatory. Refcounting is a no-op (fixed lifetime tied to RunPluginWindow's stack) —
// safe because this object is never actually deleted mid-use and no other holder outlives the
// function.
class MinimalPlugFrame : public Steinberg::IPlugFrame {
 public:
  Steinberg::tresult PLUGIN_API queryInterface(const Steinberg::TUID iid, void** obj) override {
    if (Steinberg::FUnknownPrivate::iidEqual(iid, Steinberg::FUnknown::iid)
        || Steinberg::FUnknownPrivate::iidEqual(iid, Steinberg::IPlugFrame::iid)) {
      *obj = static_cast<Steinberg::IPlugFrame*>(this);
      return Steinberg::kResultOk;
    }
    *obj = nullptr;
    return Steinberg::kNoInterface;
  }
  Steinberg::uint32 PLUGIN_API addRef() override { return 1; }
  Steinberg::uint32 PLUGIN_API release() override { return 1; }

  Steinberg::tresult PLUGIN_API resizeView(Steinberg::IPlugView* view, Steinberg::ViewRect* newSize) override {
    // We drive sizing ourselves (the caller's placeholder rect / repositionPluginEditor), so a
    // plugin-initiated resize request is just acknowledged, not acted on — matches the documented
    // contract (host may ignore/clamp) without needing round-trip machinery back into the
    // instance's own window-resize path.
    if (view && newSize) view->onSize(newSize);
    return Steinberg::kResultOk;
  }
};

// Payload for WM_APP_REPOSITION, heap-allocated by the caller and freed by the window thread
// after applying it — PostThreadMessage only carries two pointer-sized values (WPARAM/LPARAM),
// not enough for four ints, so the rect rides across threads as a pointer instead.
struct RepositionPayload {
  int32_t x, y, width, height;
};

struct PluginInstance {
  std::string id;
  std::string path;
  std::thread thread;
  DWORD threadId = 0;
  std::atomic<HWND> hwnd{nullptr};

  // Embedding: reparented as a WS_CHILD of the caller's own window instead of a standalone
  // WS_OVERLAPPEDWINDOW. parentHwnd/x/y/width/height are only meaningful when embedded is true —
  // read once by RunPluginWindow at creation time, never touched again from another thread
  // (repositioning after that goes through the posted-message queue like closing does, not by
  // mutating these fields directly, so nothing here needs its own lock).
  bool embedded = false;
  HWND parentHwnd = nullptr;
  int32_t initialX = 0, initialY = 0, initialWidth = 0, initialHeight = 0;

  // Set once by RunPluginWindow before signaling ready (see reportedWidth/Height below), then
  // read again by the same thread's own WM_APP_REPOSITION handling — never touched concurrently.
  bool resizable = true;

  std::mutex readyMutex;
  std::condition_variable readyCv;
  bool ready = false;  // set once open has either succeeded or failed
  bool openOk = false;
  std::string openError;
  // The size actually applied to the WS_CHILD window: equal to the caller's requested
  // initialWidth/initialHeight for a resizable plugin GUI, or the plugin's own native size for a
  // fixed-size one (see the canResize()/getSize() handling in RunPluginWindow) — a fixed-size
  // plugin GUI just keeps painting at its native size no matter what onSize() is told, so forcing
  // the window to the placeholder's size left dead space filled with the window class's default
  // white background brush. Read by OpenPluginEditorEmbeddedWorker::OnOK() once ready is set.
  int32_t reportedWidth = 0, reportedHeight = 0;
};

std::mutex g_instancesMutex;
std::unordered_map<std::string, std::unique_ptr<PluginInstance>> g_instances;

std::string MakeInstanceId() {
  static std::atomic<uint64_t> counter{0};
  return "vst3-" + std::to_string(GetTickCount64()) + "-" + std::to_string(counter.fetch_add(1));
}

// Runs entirely on its own dedicated thread for the instance's whole lifetime: loads the
// module, builds the Component/Controller/IConnectionPoint bridge (the same proven sequence as
// ProcessGuiTest above), creates and shows a real window, attaches the editor view, then pumps
// a real Win32 message loop until told to stop via a posted WM_APP_CLOSE_EDITOR.
void RunPluginWindow(PluginInstance* inst) {
  using namespace Steinberg;
  using namespace Steinberg::Vst;

  // Force this thread's message queue to exist before anything else — PostThreadMessage() (used
  // by closePluginEditor) silently fails if the target thread has never called a message-
  // retrieval function once.
  MSG primeMsg;
  PeekMessageW(&primeMsg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  inst->threadId = GetCurrentThreadId();

  auto fail = [&](const std::string& message) {
    std::lock_guard<std::mutex> lock(inst->readyMutex);
    inst->openOk = false;
    inst->openError = message;
    inst->ready = true;
    inst->readyCv.notify_all();
  };

  std::string errorDescription;
  Module::Ptr module = Module::create(inst->path, errorDescription);
  if (!module) {
    fail("Failed to load VST3 module: " + errorDescription);
    return;
  }

  HostApplication hostApplication;
  const auto& factory = module->getFactory();
  factory.setHostContext(&hostApplication);

  VST3::UID audioClassId;
  bool foundAudioClass = false;
  {
    std::vector<ClassInfo> infos = factory.classInfos();
    for (const auto& ci : infos) {
      if (ci.category() == std::string(kVstAudioEffectClass)) {
        audioClassId = ci.ID();
        foundAudioClass = true;
        break;
      }
    }
  }
  if (!foundAudioClass) {
    fail("No Audio Module Class found in this plugin");
    return;
  }

  IPtr<IComponent> component = factory.createInstance<IComponent>(audioClassId);
  if (!component || component->initialize(&hostApplication) != kResultOk) {
    fail("component create/initialize failed");
    return;
  }
  auto terminateComponent = [&]() { component->terminate(); };

  IPtr<IEditController> controller;
  FUnknownPtr<IConnectionPoint> componentCP;
  FUnknownPtr<IConnectionPoint> controllerCP;
  TUID controllerCID{};
  if (component->getControllerClassId(controllerCID) == kResultOk) {
    VST3::UID controllerUID(VST3::UID::fromTUID(controllerCID));
    controller = factory.createInstance<IEditController>(controllerUID);
    if (controller && controller->initialize(&hostApplication) != kResultOk) controller = nullptr;
    if (controller) {
      componentCP = FUnknownPtr<IConnectionPoint>(component.get());
      controllerCP = FUnknownPtr<IConnectionPoint>(controller.get());
      if (componentCP && controllerCP) {
        componentCP->connect(controllerCP.get());
        controllerCP->connect(componentCP.get());
      }
      MemoryStream componentState;
      if (component->getState(&componentState) == kResultOk) {
        componentState.seek(0, IBStream::kIBSeekSet, nullptr);
        controller->setComponentState(&componentState);
      }
    }
  }
  auto terminateController = [&]() {
    if (!controller) return;
    if (componentCP && controllerCP) {
      componentCP->disconnect(controllerCP.get());
      controllerCP->disconnect(componentCP.get());
    }
    controller->terminate();
    controller = nullptr;
  };

  if (!controller) {
    terminateComponent();
    fail("Plugin has no separate EditController — cannot open an editor");
    return;
  }

  IPlugView* view = controller->createView(ViewType::kEditor);
  if (!view) {
    terminateController();
    terminateComponent();
    fail("controller->createView(kEditor) returned null");
    return;
  }

  if (view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) {
    view->release();
    terminateController();
    terminateComponent();
    fail("Plugin editor does not support kPlatformTypeHWND");
    return;
  }

  static const wchar_t* kClassName = L"RhymixVst3EditorWindow";
  WNDCLASSW wc{};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = kClassName;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  RegisterClassW(&wc);  // harmless failure if already registered by a prior instance in this process

  HWND hwnd;
  if (inst->embedded) {
    // WS_CHILD + no title bar/border, parented straight to the caller's own window via
    // hwndParent at CreateWindowExW time — this (not a later SetParent() call) is what makes
    // the window belong to the app's own window tree from the very first paint, no flash of a
    // separate top-level window that then gets reparented.
    hwnd = CreateWindowExW(0, kClassName, L"", WS_CHILD | WS_VISIBLE, inst->initialX, inst->initialY,
                            inst->initialWidth, inst->initialHeight, inst->parentHwnd, nullptr,
                            GetModuleHandleW(nullptr), nullptr);
  } else {
    hwnd = CreateWindowExW(0, kClassName, L"Rhymix Plugin", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT,
                            CW_USEDEFAULT, 800, 600, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  }
  if (!hwnd) {
    view->release();
    terminateController();
    terminateComponent();
    fail(inst->embedded ? "CreateWindowExW (embedded child) failed" : "CreateWindowExW failed");
    return;
  }

  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);

  // Give the plugin a real IPlugFrame before attached() — see MinimalPlugFrame's comment for why
  // this turned out to matter for at least one real-world plugin family (iZotope RX 11).
  MinimalPlugFrame plugFrame;
  view->setFrame(&plugFrame);

  tresult attachResult = view->attached(hwnd, kPlatformTypeHWND);
  if (attachResult != kResultOk) {
    view->release();
    DestroyWindow(hwnd);
    terminateController();
    terminateComponent();
    fail("view->attached() failed");
    return;
  }

  bool resizable = true;
  int32_t appliedWidth = inst->initialWidth;
  int32_t appliedHeight = inst->initialHeight;
  if (inst->embedded) {
    // The caller's placeholder rect wins ONLY if the plugin's own GUI actually supports being
    // resized to it — many VST3 GUI toolkits report canResize() == false and just keep painting
    // at their fixed native size no matter what onSize() is told, which left the rest of the
    // WS_CHILD window (forced to the placeholder's size regardless) as dead space filled with the
    // window class's default white background brush — this is what iZotope RX 11 Breath
    // Control's blank lower panel turned out to be (see README, 2026-09-25 investigation). For a
    // fixed-size GUI, size the window to its own real size via getSize() instead, and report that
    // real size back to the caller (OpenPluginEditorEmbeddedWorker::OnOK) so the frontend can size
    // the placeholder around the plugin rather than the other way around.
    resizable = (view->canResize() == kResultTrue);
    if (resizable) {
      ViewRect embeddedRect{0, 0, inst->initialWidth, inst->initialHeight};
      view->onSize(&embeddedRect);
    } else {
      ViewRect nativeRect{};
      if (view->getSize(&nativeRect) == kResultOk) {
        int32_t w = nativeRect.right - nativeRect.left;
        int32_t h = nativeRect.bottom - nativeRect.top;
        if (w > 0 && h > 0) {
          appliedWidth = w;
          appliedHeight = h;
        }
      }
      SetWindowPos(hwnd, nullptr, 0, 0, appliedWidth, appliedHeight, SWP_NOMOVE | SWP_NOZORDER);
      ViewRect appliedRect{0, 0, appliedWidth, appliedHeight};
      view->onSize(&appliedRect);
    }
  } else {
    ViewRect rect{};
    if (view->getSize(&rect) == kResultOk) {
      int32_t w = rect.right - rect.left;
      int32_t h = rect.bottom - rect.top;
      if (w > 0 && h > 0) {
        RECT wr{0, 0, w, h};
        AdjustWindowRect(&wr, WS_OVERLAPPEDWINDOW, FALSE);
        SetWindowPos(hwnd, nullptr, 0, 0, wr.right - wr.left, wr.bottom - wr.top, SWP_NOMOVE | SWP_NOZORDER);
        view->onSize(&rect);
      }
    }
  }

  inst->hwnd.store(hwnd);
  inst->resizable = resizable;

  {
    std::lock_guard<std::mutex> lock(inst->readyMutex);
    inst->openOk = true;
    inst->ready = true;
    inst->reportedWidth = appliedWidth;
    inst->reportedHeight = appliedHeight;
  }
  inst->readyCv.notify_all();

  // The real, persistent message loop — what actually lets the plugin's own GUI run (redraw
  // timers, mouse/keyboard input) for as long as the instance stays open, without blocking
  // anything outside this thread. GetMessageW blocks efficiently between messages rather than
  // busy-polling.
  MSG msg;
  BOOL got;
  while ((got = GetMessageW(&msg, nullptr, 0, 0)) != 0) {
    if (got == -1) break;
    if (msg.message == WM_APP_CLOSE_EDITOR) break;
    if (msg.message == WM_APP_REPOSITION) {
      // lParam is a heap-allocated RepositionPayload* — owned by the poster
      // (RepositionPluginEditorWorker), freed here once applied.
      std::unique_ptr<RepositionPayload> payload(reinterpret_cast<RepositionPayload*>(msg.lParam));
      if (payload && inst->embedded) {
        if (resizable) {
          SetWindowPos(hwnd, nullptr, payload->x, payload->y, payload->width, payload->height,
                       SWP_NOZORDER | SWP_NOACTIVATE);
          ViewRect newRect{0, 0, payload->width, payload->height};
          view->onSize(&newRect);
        } else {
          // Fixed-size GUI: never restretch it to the caller's placeholder rect (see the
          // canResize() handling above) — just keep it centered within whatever space the
          // placeholder now occupies, at its own unchanged native size.
          int32_t centeredX = payload->x + std::max(0, (payload->width - appliedWidth) / 2);
          int32_t centeredY = payload->y + std::max(0, (payload->height - appliedHeight) / 2);
          SetWindowPos(hwnd, nullptr, centeredX, centeredY, appliedWidth, appliedHeight,
                       SWP_NOZORDER | SWP_NOACTIVATE);
        }
      }
      continue;
    }
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  view->removed();
  view->release();
  DestroyWindow(hwnd);
  inst->hwnd.store(nullptr);
  terminateController();
  terminateComponent();
}

class OpenPluginEditorWorker : public Napi::AsyncWorker {
 public:
  OpenPluginEditorWorker(Napi::Env env, std::string path)
      : Napi::AsyncWorker(env), path_(std::move(path)), deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    auto inst = std::make_unique<PluginInstance>();
    inst->id = MakeInstanceId();
    inst->path = path_;
    PluginInstance* raw = inst.get();

    raw->thread = std::thread(RunPluginWindow, raw);

    {
      std::unique_lock<std::mutex> lock(raw->readyMutex);
      raw->readyCv.wait(lock, [&] { return raw->ready; });
    }

    if (!raw->openOk) {
      // The window thread has already returned in this case (it only reaches the message loop
      // after setting ready=true on success) — safe to join immediately, nothing to wait on.
      if (raw->thread.joinable()) raw->thread.join();
      SetError(raw->openError);
      return;
    }

    instanceId_ = raw->id;
    std::lock_guard<std::mutex> lock(g_instancesMutex);
    g_instances.emplace(raw->id, std::move(inst));
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("instanceId", Napi::String::New(env, instanceId_));
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  std::string path_;
  std::string instanceId_;
  Napi::Promise::Deferred deferred_;
};

class ClosePluginEditorWorker : public Napi::AsyncWorker {
 public:
  ClosePluginEditorWorker(Napi::Env env, std::string instanceId)
      : Napi::AsyncWorker(env),
        instanceId_(std::move(instanceId)),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    std::unique_ptr<PluginInstance> inst;
    {
      std::lock_guard<std::mutex> lock(g_instancesMutex);
      auto it = g_instances.find(instanceId_);
      if (it == g_instances.end()) {
        SetError("No open plugin editor with instanceId: " + instanceId_);
        return;
      }
      inst = std::move(it->second);
      g_instances.erase(it);
    }

    PostThreadMessage(inst->threadId, WM_APP_CLOSE_EDITOR, 0, 0);
    if (inst->thread.joinable()) inst->thread.join();
    found_ = true;
  }

  void OnOK() override { deferred_.Resolve(Napi::Boolean::New(Env(), found_)); }
  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  std::string instanceId_;
  bool found_ = false;
  Napi::Promise::Deferred deferred_;
};

class OpenPluginEditorEmbeddedWorker : public Napi::AsyncWorker {
 public:
  OpenPluginEditorEmbeddedWorker(Napi::Env env, std::string path, HWND parentHwnd, int32_t x, int32_t y,
                                  int32_t width, int32_t height)
      : Napi::AsyncWorker(env),
        path_(std::move(path)),
        parentHwnd_(parentHwnd),
        x_(x), y_(y), width_(width), height_(height),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    auto inst = std::make_unique<PluginInstance>();
    inst->id = MakeInstanceId();
    inst->path = path_;
    inst->embedded = true;
    inst->parentHwnd = parentHwnd_;
    inst->initialX = x_;
    inst->initialY = y_;
    inst->initialWidth = width_;
    inst->initialHeight = height_;
    PluginInstance* raw = inst.get();

    raw->thread = std::thread(RunPluginWindow, raw);

    {
      std::unique_lock<std::mutex> lock(raw->readyMutex);
      raw->readyCv.wait(lock, [&] { return raw->ready; });
    }

    if (!raw->openOk) {
      if (raw->thread.joinable()) raw->thread.join();
      SetError(raw->openError);
      return;
    }

    instanceId_ = raw->id;
    resizable_ = raw->resizable;
    reportedWidth_ = raw->reportedWidth;
    reportedHeight_ = raw->reportedHeight;
    std::lock_guard<std::mutex> lock(g_instancesMutex);
    g_instances.emplace(raw->id, std::move(inst));
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("instanceId", Napi::String::New(env, instanceId_));
    // The size actually applied — equal to the requested placeholder size for a resizable plugin
    // GUI, or the plugin's own fixed native size otherwise (see RunPluginWindow's canResize()
    // handling). The frontend uses this to size the placeholder around a fixed-size plugin
    // instead of leaving dead space around/inside it.
    result.Set("resizable", Napi::Boolean::New(env, resizable_));
    result.Set("width", Napi::Number::New(env, reportedWidth_));
    result.Set("height", Napi::Number::New(env, reportedHeight_));
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  std::string path_;
  HWND parentHwnd_;
  int32_t x_, y_, width_, height_;
  std::string instanceId_;
  bool resizable_ = true;
  int32_t reportedWidth_ = 0, reportedHeight_ = 0;
  Napi::Promise::Deferred deferred_;
};

// Fire-and-confirm rather than a full round trip through the window thread: posting succeeding
// means the message was queued, not that it's been applied yet (same fire-and-forget nature as
// closePluginEditor's PostThreadMessage) — good enough for a UI-driven drag/resize where the
// caller doesn't need to block on each intermediate frame, only the final state matters visually.
class RepositionPluginEditorWorker : public Napi::AsyncWorker {
 public:
  RepositionPluginEditorWorker(Napi::Env env, std::string instanceId, int32_t x, int32_t y, int32_t width,
                                int32_t height)
      : Napi::AsyncWorker(env),
        instanceId_(std::move(instanceId)),
        x_(x), y_(y), width_(width), height_(height),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    DWORD threadId;
    bool isEmbedded;
    {
      std::lock_guard<std::mutex> lock(g_instancesMutex);
      auto it = g_instances.find(instanceId_);
      if (it == g_instances.end()) {
        SetError("No open plugin editor with instanceId: " + instanceId_);
        return;
      }
      threadId = it->second->threadId;
      isEmbedded = it->second->embedded;
    }
    if (!isEmbedded) {
      SetError("repositionPluginEditor: instance " + instanceId_ + " was not opened embedded");
      return;
    }
    auto* payload = new RepositionPayload{x_, y_, width_, height_};
    if (!PostThreadMessage(threadId, WM_APP_REPOSITION, 0, reinterpret_cast<LPARAM>(payload))) {
      delete payload;  // post failed — nothing will free it otherwise
      SetError("PostThreadMessage(WM_APP_REPOSITION) failed");
      return;
    }
    found_ = true;
  }

  void OnOK() override { deferred_.Resolve(Napi::Boolean::New(Env(), found_)); }
  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  std::string instanceId_;
  int32_t x_, y_, width_, height_;
  bool found_ = false;
  Napi::Promise::Deferred deferred_;
};

class ScanPluginsWorker : public Napi::AsyncWorker {
 public:
  ScanPluginsWorker(Napi::Env env, std::vector<std::string> directories)
      : Napi::AsyncWorker(env),
        directories_(std::move(directories)),
        deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise GetPromise() { return deferred_.Promise(); }

  void Execute() override {
    namespace fs = std::filesystem;
    using namespace Steinberg::Vst;

    for (const auto& dir : directories_) {
      std::error_code ec;
      if (!fs::exists(dir, ec) || ec || !fs::is_directory(dir, ec) || ec) continue;

      // Recursive, not a flat directory_iterator: real-world VST3 installs are laid out as
      // <root>/<Vendor>/<Plugin>.vst3 (confirmed on this machine — the top-level
      // "Common Files/VST3" directory holds only vendor subfolders, no .vst3 files directly in
      // it), so a single-level scan of the conventional root directory would always find zero
      // plugins. recursive_directory_iterator has no depth cap, which is fine for a vendor-folder
      // tree that's never pathologically deep in practice.
      std::error_code iterEc;
      for (auto it = fs::recursive_directory_iterator(dir, iterEc);
           !iterEc && it != fs::recursive_directory_iterator();
           it.increment(iterEc)) {
        if (it->path().extension() != ".vst3") continue;

        // A .vst3 bundle (the common case on Windows too, not just macOS) is itself a directory
        // containing the real binary one level further down, e.g.
        // Dexed.vst3/Contents/x86_64-win/Dexed.vst3 — without disable_recursion_pending() here,
        // recursive_directory_iterator walks straight into that inner .vst3-suffixed binary and
        // reports it as a second, separate plugin. The bundle root is the one real entry;
        // whatever a loadable Module::create finds inside it is what matters, not a raw
        // recursive filename match.
        if (it->is_directory()) it.disable_recursion_pending();

        std::string entryPath = it->path().string();
        std::string errorDescription;
        Module::Ptr module = Module::create(entryPath, errorDescription);
        if (!module) continue;  // not every .vst3-suffixed entry is necessarily loadable; skip quietly

        const auto& factory = module->getFactory();
        auto factoryInfo = factory.info();
        std::vector<ClassInfo> classInfos = factory.classInfos();
        for (const auto& ci : classInfos) {
          if (ci.category() != std::string(kVstAudioEffectClass)) continue;
          Found f;
          f.path = entryPath;
          f.name = ci.name();
          f.vendor = !ci.vendor().empty() ? ci.vendor() : factoryInfo.vendor();
          f.category = ci.subCategoriesString();
          found_.push_back(std::move(f));
          break;  // one catalog entry per plugin file is enough for a scan list
        }
        // `module` goes out of scope at the end of this iteration and unloads — scanning never
        // leaves anything loaded, unlike openPluginEditor.
      }
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array arr = Napi::Array::New(env, found_.size());
    for (size_t i = 0; i < found_.size(); ++i) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("path", Napi::String::New(env, found_[i].path));
      o.Set("name", Napi::String::New(env, found_[i].name));
      o.Set("vendor", Napi::String::New(env, found_[i].vendor));
      o.Set("category", Napi::String::New(env, found_[i].category));
      arr.Set(static_cast<uint32_t>(i), o);
    }
    deferred_.Resolve(arr);
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  struct Found {
    std::string path, name, vendor, category;
  };
  std::vector<std::string> directories_;
  std::vector<Found> found_;
  Napi::Promise::Deferred deferred_;
};

Napi::Value ScanPlugins(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "scanPlugins(directories: string[]) expects an array").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Array arr = info[0].As<Napi::Array>();
  std::vector<std::string> directories;
  for (uint32_t i = 0; i < arr.Length(); ++i) {
    Napi::Value v = arr.Get(i);
    if (v.IsString()) directories.push_back(v.As<Napi::String>().Utf8Value());
  }
  auto* worker = new ScanPluginsWorker(env, std::move(directories));
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

Napi::Value OpenPluginEditor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "openPluginEditor(path: string) expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  auto* worker = new OpenPluginEditorWorker(env, std::move(path));
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

// Electron's BrowserWindow.getNativeWindowHandle() returns a Node Buffer holding the raw HWND
// bytes (a pointer-sized value, little-endian, same layout as any native pointer on this
// platform) — this is the documented, standard way to get a real Win32 handle for a specific
// Electron window across to native code; there's no higher-level Electron/N-API API for it.
HWND HwndFromBuffer(const Napi::Buffer<uint8_t>& buf) {
  if (buf.ByteLength() < sizeof(HWND)) return nullptr;
  HWND hwnd;
  std::memcpy(&hwnd, buf.Data(), sizeof(HWND));
  return hwnd;
}

Napi::Value OpenPluginEditorEmbedded(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 6 || !info[0].IsString() || !info[1].IsBuffer() || !info[2].IsNumber()
      || !info[3].IsNumber() || !info[4].IsNumber() || !info[5].IsNumber()) {
    Napi::TypeError::New(
        env, "openPluginEditorEmbedded(path: string, parentHwnd: Buffer, x: number, y: number, "
             "width: number, height: number) — wrong argument types")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  HWND parentHwnd = HwndFromBuffer(info[1].As<Napi::Buffer<uint8_t>>());
  if (!parentHwnd) {
    Napi::TypeError::New(env, "openPluginEditorEmbedded: parentHwnd buffer did not decode to a valid handle")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  int32_t x = info[2].As<Napi::Number>().Int32Value();
  int32_t y = info[3].As<Napi::Number>().Int32Value();
  int32_t width = info[4].As<Napi::Number>().Int32Value();
  int32_t height = info[5].As<Napi::Number>().Int32Value();
  auto* worker = new OpenPluginEditorEmbeddedWorker(env, std::move(path), parentHwnd, x, y, width, height);
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

Napi::Value RepositionPluginEditor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()
      || !info[3].IsNumber() || !info[4].IsNumber()) {
    Napi::TypeError::New(
        env, "repositionPluginEditor(instanceId: string, x: number, y: number, width: number, "
             "height: number) — wrong argument types")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string instanceId = info[0].As<Napi::String>().Utf8Value();
  int32_t x = info[1].As<Napi::Number>().Int32Value();
  int32_t y = info[2].As<Napi::Number>().Int32Value();
  int32_t width = info[3].As<Napi::Number>().Int32Value();
  int32_t height = info[4].As<Napi::Number>().Int32Value();
  auto* worker = new RepositionPluginEditorWorker(env, std::move(instanceId), x, y, width, height);
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

Napi::Value ClosePluginEditor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "closePluginEditor(instanceId: string) expects a string").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string instanceId = info[0].As<Napi::String>().Utf8Value();
  auto* worker = new ClosePluginEditorWorker(env, std::move(instanceId));
  Napi::Promise promise = worker->GetPromise();
  worker->Queue();
  return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("loadPlugin", Napi::Function::New(env, LoadPlugin));
  exports.Set("processAudioTest", Napi::Function::New(env, ProcessAudioTest));
  exports.Set("processParamDiffTest", Napi::Function::New(env, ProcessParamDiffTest));
  // Diagnostic only — not wired through native/shell's IPC, not part of the shipped
  // window.rhymixNative surface. See the comment above ProcessLatencyAwareDiffTest's definition.
  exports.Set("processLatencyAwareDiffTest", Napi::Function::New(env, ProcessLatencyAwareDiffTest));
  // Diagnostic only — not wired through native/shell's IPC. See the comment above
  // ListPluginParams's definition.
  exports.Set("listPluginParams", Napi::Function::New(env, ListPluginParams));
  // Diagnostic only — not wired through native/shell's IPC. See the comment above
  // ProcessDehumLearnTest's definition.
  exports.Set("processDehumLearnTest", Napi::Function::New(env, ProcessDehumLearnTest));
  exports.Set("processLearnLikeToggleTest", Napi::Function::New(env, ProcessLearnLikeToggleTest));
  // Diagnostic only — not wired through native/shell's IPC, not part of the shipped
  // window.rhymixNative surface. See the comment above ProcessDrmTheoryTest's definition.
  exports.Set("processDrmTheoryTest", Napi::Function::New(env, ProcessDrmTheoryTest));
  exports.Set("processSynthTest", Napi::Function::New(env, ProcessSynthTest));
  exports.Set("processGuiTest", Napi::Function::New(env, ProcessGuiTest));
  exports.Set("renderAudioFile", Napi::Function::New(env, RenderAudioFile));
  exports.Set("scanPlugins", Napi::Function::New(env, ScanPlugins));
  exports.Set("openPluginEditor", Napi::Function::New(env, OpenPluginEditor));
  exports.Set("openPluginEditorEmbedded", Napi::Function::New(env, OpenPluginEditorEmbedded));
  exports.Set("repositionPluginEditor", Napi::Function::New(env, RepositionPluginEditor));
  exports.Set("closePluginEditor", Napi::Function::New(env, ClosePluginEditor));
  return exports;
}

}  // namespace

NODE_API_MODULE(rhymix_vst3_host, Init)
