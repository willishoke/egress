
#include "RtAudio.h"
#include "Rack.hpp"
#include <curses.h>
#include <iostream>
#include <cstdlib>
#include <cmath>
#include <utility>


// Callback function automatically invoked when buffer is empty
// Adapted from RtAudio documentation:
// https://www.music.mcgill.ca/~gary/rtaudio/playback.html
int fillBuffer 
( void * outputBuffer, 
  void * inputBuffer, 
  unsigned int nBufferFrames,
  double streamTime, 
  RtAudioStreamStatus status, 
  void * rack 
)
{
  double * buffer = (double *) outputBuffer;
  Rack * r = (Rack *) rack;
  if (status)
    std::cout << "Stream underflow detected!" << std::endl;

  //std::cout << rack << std::endl;
  // fill rack mixer buffer and update values
  r->process();

  // write interleaved audio data
  for (auto i = 0; i < nBufferFrames; ++i) 
  {
    for (auto j = 0; j < 2; j++) 
    {
      *buffer++ = r->outputBuffer.at(i);
    }
  }
  return 0;
}

void closeStream(RtAudio & dac)
{
  try 
  {
    dac.stopStream();
  }

  catch (RtAudioError& e) 
  {
    e.printMessage();
  }

  if (dac.isStreamOpen()) 
  {
    dac.closeStream();
  }
}

int main()
{
  RtAudio dac;
  if (dac.getDeviceCount() < 1) 
  {
    std::cout << "\nNo audio devices found!\n";
    exit(0);
  }
  RtAudio::StreamParameters parameters;
  parameters.deviceId = dac.getDefaultOutputDevice();
  parameters.nChannels = 2;
  parameters.firstChannel = 0;
  unsigned int sampleRate = 44100;
  unsigned int bufferFrames = 64;  

  Rack rack(bufferFrames);


  rack.addModule("vco1", std::make_unique<VCO>(100));
  rack.addModule("vco2", std::make_unique<VCO>(2.0));
  rack.addModule("vco3", std::make_unique<VCO>(1.0));
  rack.addModule("vca1", std::make_unique<MUL>());
  rack.addModule("lfo1", std::make_unique<VCO>(.01));
  rack.addModule("lfo2", std::make_unique<VCO>(10));
  rack.addModule("c", std::make_unique<CONST>(1.5));

  rack.connect("vco2", VCO::SIN, "vco1", VCO::FM);
  rack.connect("vco3", VCO::SIN, "vco2", VCO::FM);
  rack.connect("vco1", VCO::SIN, "vco3", VCO::FM);
  rack.connect("lfo1", VCO::SAW, "vco3", VCO::FM);
  rack.connect("vco1", VCO::SIN, "vca1", MUL::IN1);
  rack.connect("lfo1", VCO::SIN, "vca1", MUL::IN2);

  rack.connect("c", CONST::OUT, "vco3", VCO::FM_INDEX);
  rack.connect("c", CONST::OUT, "vco1", VCO::FM_INDEX);
  rack.connect("lfo1", VCO::SIN, "vco2", VCO::FM_INDEX);

  rack.addOutput(std::make_pair("vca1", MUL::OUT));
  rack.addOutput(std::make_pair("vco2", VCO::SIN));

  try 
  {
    dac.openStream
      ( &parameters, 
        NULL, 
        RTAUDIO_FLOAT64,
        sampleRate, 
        &bufferFrames, 
        &fillBuffer, 
        (void*) &rack
      );
    dac.startStream();
  }

  catch (RtAudioError& e) 
  {
    e.printMessage();
    exit(0);
  }
  initscr();
  getch();
  endwin();
  closeStream(dac);
  return 0;
}
