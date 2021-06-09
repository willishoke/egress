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

    void postprocess()
    {
      for (auto & in : inputs)
      {
        in = 0.0;
      }
     
      // apply thresholding to restrict output to range [-10.0, 10.0] 
      for (auto & out : outputs)
      {
        out = fmin(out, 10.0);
        out = fmax(out, -10.0);
      }
    }
   
    std::string module_name;

  protected:
    std::vector<Signal> inputs;
    std::vector<Signal> outputs;

  private:
    friend class Rack;
};


// saw core lets us "easily" get 4 output waveforms
// core takes on values in range [0.0, 1.0]
// output in range [-5.0, 5.0]
class VCO : public Module
{ 
  public:
    // invoke base class constructor
    VCO(int freq) : Module(IN_COUNT, OUT_COUNT) 
    {
      frequency = freq;
      core = 0.0;
    }
  
    enum Ins
    {
      FM,
      FM_INDEX,
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

    void process() 
    {
      // calculate FM value
      double fm = pow(2, inputs[FM_INDEX] * inputs[FM] / 5.0);

      // apply exponential FM
      double freq = frequency * fm;

      // increment core value
      core += freq / 44100;

      // floating point modulus resets core when it hits 1.0
      core = fmod(core, 1.0);

      // saw is scaled and shifted version of core
      outputs[SAW] = 10.0 * core - 5.0;

      // tri is rectified and scaled saw
      outputs[TRI] = 2.0 * abs(outputs[SAW]) - 5.0;

      // scale tri to range [0.0, 1.0], apply cos, rescale
      outputs[SIN] = -5.0 * cos(M_PI * (outputs[TRI] / 10.0 + 0.5));

      // simple step function
      outputs[SQR] = core - 0.5 > 0.0 ? 5.0 : -5.0;
      
      // invoke postprocessing routine
      Module::postprocess();

      inputs[FM_INDEX] = 5.0;

      #ifdef DEBUG
      // for debugging, runs for single cycle and pipe stdout to csv
      std::cout << core << ' ';
      for (auto i = 0; i < OUT_COUNT; ++i) {
        std::cout << outputs[i] << ' ';
      }
      #endif // DEBUG
    }

  private:
    double frequency;
    double core; 
};

class MUX : public Module
{
  public:
    MUX() : Module(IN_COUNT, OUT_COUNT) {}
  
    enum Ins
    {
      IN1,
      IN2,
      CTRL,
      IN_COUNT
    };
  
    enum Outs
    {
      OUT,
      OUT_COUNT
    };

    void process() 
    {
      // route input depending on polarity of control signal
      outputs[OUT] = inputs[CTRL] > 0.0 ? IN1 : IN2;

      // invoke postprocessing routine
      Module::postprocess();
    }
};

// 4-quadrant multiplier
// two inputs, one output

class MUL : public Module
{
  public:
    MUL() : Module(IN_COUNT, OUT_COUNT) {}
 
    enum Ins
    {
      IN1,
      IN2,
      IN_COUNT
    };
  
    enum Outs
    {
      OUT,
      OUT_COUNT
    };

    void process() 
    {
      // update output value, downscaling to avoid clipping
      outputs[OUT] = inputs[IN1] * inputs[IN2] / 5.0;

      // clean up
      Module::postprocess();
    }
};

class DELAY : public Module
{
  public:
    DELAY(double time) : Module(IN_COUNT, OUT_COUNT)
    {
      bufferSize = time;
      bufferPosition = 0;
      buffer.resize(time);       
    }

    enum Ins
    {
      IN,
      IN_COUNT
    };
  
    enum Outs
    {
      OUT,
      OUT_COUNT
    };

    void process() 
    {
      // write most recent value to buffer
      buffer[bufferPosition++] = inputs[IN];
      bufferPosition %= bufferSize;

      // update output value
      outputs[OUT] = buffer[bufferPosition];

      // clean up
      Module::postprocess();
    }

  private:
    unsigned int bufferSize; 
    unsigned int bufferPosition;
    std::vector<Signal> buffer;
};

class CONST : public Module
{
  public:
    CONST(Signal s) : Module(IN_COUNT, OUT_COUNT)
    {
      value = s; 
    }

    enum Ins
    {
      IN_COUNT
    };
  
    enum Outs
    {
      OUT,
      OUT_COUNT
    };

    void process() 
    {
      // update output value
      outputs[OUT] = value;

      // clean up
      Module::postprocess();
    }

  private:
    Signal value; 
};
