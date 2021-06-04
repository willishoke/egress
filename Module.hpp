#include <vector>
#include <math.h>

using Signal = double;

class Module
{
  public:
    virtual ~Module() {}

    Module(int in_size, int out_size)
    {
      ++module_count;
      inputs.resize(in_size);
      outputs.resize(out_size);
    }

    virtual void process() = 0;
   
    std::string module_name;
    unsigned int module_id; 
    static unsigned int module_count;

  protected:
    std::vector<Signal> inputs;
    std::vector<Signal> outputs;

  private:
    friend class Rack;
};

class VCO : public Module
{ 
  public:
    VCO(int buffer_size) : 
      Module(
        IN_COUNT,
        OUT_COUNT
      ) {}
  
    enum Ins
    {
      FM,
      AM,
      IN_COUNT
    };
  
    enum Outs
    {
      SIN,
      TRI,
      SQR,
      OUT_COUNT
    };

    void process() 
    {
      // Multiply by 2 since using triangular base
      double step = 2 * 44100 / freq; 
      if (!rising) step = -step;

      value += step;
      value *= inputs[AM] / 5.0;

      // lots of potential for optimization here --
      //  calculate values on demand?
      outputs[TRI] = value;
      outputs[SQR] = value > 0.0 ? 5.0 : -5.0;
      outputs[SIN] = sin(value);

      if (value > 5.0) 
      {
        value = 5.0;
        rising = !rising;
      }

      if (value < -5.0) 
      {
        value = -5.0;
        rising = !rising;
      }
    }
  private:
    double freq;
    double value; 
    bool rising;
};
