/* 
 * * * * * * * *
 * E G R E S S *
 * * * * * * * *
 */


#include "../lib/RtAudio.h"
#include "../src/Rack.hpp"
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

void SQR_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(440));

  rack.addOutput(std::make_pair("vco1", VCO::SQR));
}

void SIN_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(440));

  rack.addOutput(std::make_pair("vco1", VCO::SIN));
}

void TRI_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(440));

  rack.addOutput(std::make_pair("vco1", VCO::TRI));
}

void SAW_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(440));

  rack.addOutput(std::make_pair("vco1", VCO::SAW));
}

void AM_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(1000));
  rack.addModule("vco2", std::make_unique<VCO>(200));
  rack.addModule("vca1", std::make_unique<VCA>());

  rack.connect("vco1", VCO::SIN, "vca1", VCA::IN1);
  rack.connect("vco2", VCO::SIN, "vca1", VCA::IN2);
  
  rack.addOutput(std::make_pair("vca1", VCA::OUT));
}

void MUX_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(1000));
  rack.addModule("vco2", std::make_unique<VCO>(2000));
  rack.addModule("lfo1", std::make_unique<VCO>(100));
  rack.addModule("mux1", std::make_unique<MUX>());

  rack.connect("vco1", VCO::SIN, "mux1", MUX::IN1);
  rack.connect("vco2", VCO::SIN, "mux1", MUX::IN2);
  rack.connect("lfo1", VCO::SIN, "mux1", MUX::CTRL);
  
  rack.addOutput(std::make_pair("mux1", MUX::OUT));
}

void FM_test(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(1000));
  rack.addModule("vco2", std::make_unique<VCO>(200));
  rack.addModule("c1", std::make_unique<CONST>(3));

  rack.connect("vco2", VCO::SIN, "vco1", VCO::FM);
  rack.connect("c1", CONST::OUT, "vco1", VCO::FM_INDEX);
  
  rack.addOutput(std::make_pair("vco1", VCO::SIN));
}

void ENV_test(Rack & rack)
{
  rack.addModule("env1", std::make_unique<ENV>(1, 5));
  rack.addModule("lfo1", std::make_unique<VCO>(200));

  rack.connect("lfo1", VCO::SQR, "env1", ENV::TRIG);

  rack.addOutput(std::make_pair("env1", ENV::OUT));
}

/*
 * Patch with chaotic behavior
 */
void FM_chaos(Rack & rack)
{
  rack.addModule("vco1", std::make_unique<VCO>(200.1));
  rack.addModule("vco2", std::make_unique<VCO>(300.0));
  rack.addModule("vco3", std::make_unique<VCO>(100.01));
  rack.addModule("vca1", std::make_unique<VCA>());
  rack.addModule("lfo1", std::make_unique<VCO>(.01));
  rack.addModule("lfo2", std::make_unique<VCO>(10));
  rack.addModule("c", std::make_unique<CONST>(1.5));

  rack.connect("vco2", VCO::SIN, "vco1", VCO::FM);
  rack.connect("vco3", VCO::SIN, "vco2", VCO::FM);
  rack.connect("vco1", VCO::SIN, "vco3", VCO::FM);
  rack.connect("lfo1", VCO::SAW, "vco3", VCO::FM);
  rack.connect("vco1", VCO::SIN, "vca1", VCA::IN1);
  rack.connect("lfo1", VCO::SIN, "vca1", VCA::IN2);

  rack.connect("c", CONST::OUT, "vco3", VCO::FM_INDEX);
  rack.connect("c", CONST::OUT, "vco1", VCO::FM_INDEX);
  rack.connect("lfo1", VCO::SIN, "vco2", VCO::FM_INDEX);

  rack.addOutput(std::make_pair("vca1", VCA::OUT));
  rack.addOutput(std::make_pair("vco2", VCO::SIN));
}

int main(int argc, char * argv[])
{
  unsigned int bufferFrames = 2048;  

  Rack rack(bufferFrames);

  //SQR_test(rack);
  //SAW_test(rack);
  //SIN_test(rack);
  //TRI_test(rack);
  //FM_test(rack);
  //AM_test(rack);
  //MUX_test(rack);
  //FM_chaos(rack);
  // Fill single buffer, output to stdout
  ENV_test(rack);
  rack.process();

  return 0;
}
