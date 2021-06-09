/* 
 * * * * * * * *
 * E G R E S S *
 * * * * * * * *
 */

#include "RtAudio.h"
#include "Rack.hpp"
#include <curses.h>
#include <iostream>
#include <cstdlib>
#include <cmath>
#include <utility>

// Audio I/O code adapted from RtAudio documentation:
// https://www.music.mcgill.ca/~gary/rtaudio/playback.html


// Callback function automatically invoked when buffer is empty
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
  unsigned int bufferFrames = 512;  
  Rack rack(bufferFrames);
  mPtr vco = std::make_unique<VCO>(440);
  mPtr vco2 = std::make_unique<VCO>(20);
  rack.addModule("vco", std::move(vco));
  rack.addModule("vco2", std::move(vco2));
  rack.connect("vco2", VCO::SIN, "vco", VCO::FM);
  rack.addOutput(std::make_pair("vco", VCO::SIN));

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
  /* 
  std::cout << "\nEnter note\n";
  initscr();
  char str[80];
  getstr(str);
  mvprintw(0, 0, str);
  getch();
  endwin();
  */
  char a;
  std::cin >> a;
  closeStream(dac);
  return 0;
}
