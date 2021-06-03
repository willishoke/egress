#include "Module.hpp"
#include <utility>
#include <map>
#include <list>


class Rack
{
  public:
    
  private:
    std::list<std::unique_ptr<Module>> modules;
    // map pair consisting of <module_id, output_id>
    // to pair of <module_id, input_id>
    std::map<std::pair<int, int>, std::pair<int, int>> connections;
    

};
