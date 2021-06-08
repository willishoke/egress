#include <vector>
#include <math.h>

using Signal = double;

class Module
{
  public:
    virtual ~Module() {}

    Module(int in_size, int out_size)
    {
      inputs.resize(in_size);
      outputs.resize(out_size);
    }

    virtual void process() = 0;
   
    std::string module_name;

  protected:
    std::vector<Signal> inputs;
    std::vector<Signal> outputs;

  private:
    friend class Rack;
};

class VCO : public Module
{ 
  public:
    VCO(int freq) : 
      Module
      (
        IN_COUNT,
        OUT_COUNT
      ) 
    {
      frequency = freq;
      core = 0.0;
    }
  
    enum Ins
    {
      FM,
      IN_COUNT
    };
  
    enum Outs
    {
      SAW,
      TRI,
      SIN,
      SQR,
      OUT_COUNT
    };

    // saw core lets us get 4 output waveforms
    // core takes on values in range [0.0, 1.0]
    // output in range [-5.0, 5.0]
    void process() 
    {
      double freq = frequency;

      // increment core value
      core += freq / 44100;
      // floating point modulus
      core = fmod(core, 1.0);

      outputs[SAW] = 10.0 * core - 5.0;
      outputs[TRI] = 2.0 * abs(outputs[SAW]) - 5.0;
      outputs[SIN] = -5.0 * cos(M_PI * (outputs[TRI] / 10.0 + 0.5));
      outputs[SQR] = core - 0.5 > 0.0 ? 5.0 : -5.0;
       
      // for debugging emergencies, run for single cycle and pipe stdout to csv
      /*
      std::cout << core << ' ';
      for (auto i = 0; i < OUT_COUNT; ++i) {
        std::cout << outputs[i] << ' ';
      }
      */
    }

  private:
    double frequency;
    double core; 
};
