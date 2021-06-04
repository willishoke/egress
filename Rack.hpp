#include "Module.hpp"
#include <utility>
#include <map>
#include <vector>


class Rack
{
  public:
    void process()
    {
      // fill entire output buffer!
      for (auto i = 0; i < buffer_length; ++i)
      {
        // propogate values through graph
        for (auto & [from, to] : connections) 
        {
           
        }

        // update values of each module
        for (auto & m : modules)
        {
          m->process();
        }
      } 
    } 
 
    // use optional type to indicate success or failure 
    std::optional<std::unique_ptr<Module>> createModule
      ( std::string module_name, 
        std::string module_type
      )
    {
      
    }

    // this could probably be restructured to throw an exception,
    // but this more cleanly aligns with the use of optional types
    // when creating modules
    bool connect(std::string module_1, std::string module_2)
    {
      //connections.insert()
      ++module_count; 
    } 

    bool remove(std::string module_1, std::string module_2)
    {
      --module_count;
    }
    unsigned int buffer_length;
    unsigned int buffer_position;
  
  private:
    unsigned int module_count;

    // modules store their own state and calculate their own values
    std::vector<std::unique_ptr<Module>> modules;

    // keeps track of all connections between modules
    // map <module_id, output_id> -> <module_id, input_id>
    std::map<std::pair<int, int>, std::pair<int, int>> connections;

    // mono for now
    std::vector<double> outputs;
};
