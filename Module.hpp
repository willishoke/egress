#include <vector>
#include <math.h>

using Signal = double;

class Module
{
  public:
    virtual ~Module();
    Module(int b_size, int in_size, int out_size)
    {
      buffer_size = b_size;
      inputs.resize(in_size);
      outputs.resize(out_size);
      for (auto & in : inputs) in.resize(b_size);
      for (auto & out : outputs) out.resize(b_size);
    }

    virtual void process() = 0;

  protected:
    int buffer_position;
    int buffer_size;

    std::vector<std::vector<Signal>> inputs;
    std::vector<std::vector<Signal>> outputs;
};

class VCO : public Module
{ 
  public:
    VCO(int buffer_size) : 
      Module(
        buffer_size,
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
      double step = 44100 / freq;
      if (!rising) step = -step;
      value += step;

      outputs[TRI][buffer_position] = value;
      outputs[SQR][buffer_position] = value > 0.0 ? 5.0 : -5.0;
      outputs[SIN][buffer_position] = sin(value);

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

/*
class MIX : public Module
{
  
};
*/
