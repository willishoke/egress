#include "Module.hpp"
#include <utility>
#include <unordered_map>
#include <map>
#include <vector>
#include <memory>
#include <string>


using inputID = std::pair<std::string, unsigned int>;
using outputID = std::pair<std::string, unsigned int>;
using mPtr = std::unique_ptr<Module>;

/*
 * Rack is a manager class which stores a collection of modules 
 * and marshals connections between them
 * 
 */

class Rack
{
  public:
    Rack(unsigned int bufferLength) 
    {
      this->bufferLength = bufferLength;
      this->outputBuffer.resize(bufferLength);
      this->bufferPosition = 0;
    }

    void process()
    {
      // fill entire output buffer!
      for (auto i = 0; i < bufferLength; ++i)
      {
        // propogate previous values through graph
        for (const auto & [from, to] : connections) 
        {
          auto from_name = from.first;
          auto from_index = from.second; 
          auto to_name = to.first;
          auto to_index = to.second; 

          // pass output from one module to another
          modules[to_name]->inputs[to_index] = modules[from_name]->outputs[from_index];
        }

        for (auto & [name, m] : modules)
        {
          m->process();
        }

        outputBuffer[i] = 0.0;

        for (const auto & [name, index] : mix)
        {
          // default output amplitude is in range [-.25, .25] 
          // for signal in range [-5.0, 5.0]
          outputBuffer[i] += modules[name]->outputs[index] / 20.0;
        }
      } 

      #ifdef DEBUG
      for (const auto x : outputBuffer)
      {
        std::cout << x << ',';
      }

      exit(0);
      #endif // DEBUG
    } 
 
    // caller needs to use std::move to pass ownership
    bool addModule(std::string name, mPtr new_module)
    {
      // again, need to invoke move to transfer ownership 
      modules.insert({name, std::move(new_module)}); 
      return true;
    }

    bool addOutput(outputID output)
    {
      mix.push_back(output);
      return true;
    }

    // TODO: check to make sure module names and ouptut ids are valid
    // Returns true to indicate success
    bool connect
    ( 
      std::string module_1, 
      unsigned int output_id,
      std::string module_2,
      unsigned int input_id 
    )
    {
      auto m1 = std::make_pair(module_1, output_id);
      auto m2 = std::make_pair(module_2, input_id);

      // this copies the pairs, which is fine
      connections.emplace(m1, m2);

      return true;
    } 

    bool remove_connection
    ( 
      std::string module_1, 
      unsigned int output_id,
      std::string module_2,
      unsigned int input_id
    )
    {
      // first check to make sure connection exists
      // need to check both module names as well as their output ids
      // then remove connection
      return true;

      return false;
    }

    bool remove_module(std::string module_name)
    {
      // first check to make sure module exists
      for (auto && [name, m] : modules)
      {
        if (module_name == name) 
        {
          
        }
      }
      // remove all of its connections
      return true;

      return false;
    }

    // rack controls buffer -- modules only store output for single timestep
    // mono for now, values get duplicated for each channel during output
    // this needs to be public so callback can access it
    std::vector<double> outputBuffer;
  
  private:

    unsigned int bufferLength;
    unsigned int bufferPosition;

    // modules store their own state and calculate their own values
    std::map<std::string, mPtr> modules;

    // keeps track of all connections between modules
    // map <module_name, output_id> -> <module_name, input_id>
    // too bad structs don't work as keys without additional legwork
    std::multimap<inputID, outputID> connections;

    // mix keeps track of outputs 
    std::vector<outputID> mix;
};
