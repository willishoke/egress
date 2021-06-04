#include "RtAudio.h"
#include "Rack.hpp"
#include <curses.h>
#include <iostream>
#include <cstdlib>
#include <cmath>

// This is for testing callback function
struct Saw
{
  double buf[2]; 
};

// Callback function automatically invoked when buffer is empty
// Adapted from RtAudio documentation:
// https://www.music.mcgill.ca/~gary/rtaudio/playback.html
int fillBuffer 
( void* outputBuffer, 
  void* inputBuffer, 
  unsigned int nBufferFrames,
  double streamTime, 
  RtAudioStreamStatus status, 
  void* rack 
)
{
  unsigned int i, j;
  double* buffer = (double*) outputBuffer;
  Rack* r = (Rack*) rack;
  double* lastValues = NULL;
  bool up = true;
  if (status)
    std::cout << "Stream underflow detected!" << std::endl;
  // Write interleaved audio data.
  for ( i=0; i<nBufferFrames; i++ ) {
    for ( j=0; j<2; j++ ) {
      *buffer++ = sin(lastValues[j]);
      lastValues[j] += up ? 0.05 : -0.05;
      if ( lastValues[j] >= 1.0 ) up = false;
      if ( lastValues[j] <= -1.0 ) up = true;
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
  if ( dac.getDeviceCount() < 1 ) {
    std::cout << "\nNo audio devices found!\n";
    exit( 0 );
  }
  RtAudio::StreamParameters parameters;
  parameters.deviceId = dac.getDefaultOutputDevice();
  parameters.nChannels = 2;
  parameters.firstChannel = 0;
  unsigned int sampleRate = 44100;
  unsigned int bufferFrames = 256; // 256 sample frames
  Saw s;
  try {
    dac.openStream
      ( &parameters, 
        NULL, 
        RTAUDIO_FLOAT64,
        sampleRate, 
        &bufferFrames, 
        &fillBuffer, 
        (void*) &s
      );
    dac.startStream();
  }
  catch (RtAudioError& e) {
    e.printMessage();
    exit(0);
  }
 
  Rack rack; 
  std::cout << "\nEnter note\n";
  initscr();
  char str[80];
  getstr(str);
  mvprintw(0, 0, str);
  getch();
  endwin();
  closeStream(dac);
  return 0;
}
