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
    void process()
    {
      // fill entire output buffer!
      for (auto i = 0; i < bufferLength; ++i)
      {
        // propogate previous values through graph
        for (auto & [from, to] : connections) 
        {
          auto from_name = from.first;
          auto from_output = from.second; 
          auto to_name = to.first;
          auto to_input = to.second; 
        }
        ++bufferPosition;
      } 
    } 
 
    // caller needs to use std::move to pass ownership
    bool add_module(std::string name, mPtr new_module)
    {
      // again, need to invoke move to transfer ownership 
      modules.insert({name, std::move(new_module)}); 
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
      // remove all of its connections
      return true;

      return false;
    }

    unsigned int bufferLength;
    unsigned int bufferPosition;
  
  private:
    // modules store their own state and calculate their own values
    std::unordered_map<std::string, mPtr> modules;

    // keeps track of all connections between modules
    // map <module_id, output_id> -> <module_id, input_id>
    // too bad structs don't work as keys without additional legwork
    std::multimap<inputID, outputID> connections;

    // rack controls buffer -- modules only store output for single timestep
    // mono for now, values get duplicated for each channel during output
    std::vector<double> outputs;
};
