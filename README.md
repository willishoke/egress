# egress

### Willis Hoke

## Intro

`egress` is a an object-oriented C++ library for building realtime emulations of analog synthesizers. It is built to be lean, efficient, and portable, although it is currently only tested on MacOS. No external libraries are required. Sample implementations are provided for voltage controlled oscillators (`VCO`), four-quadrant multipliers (`MUL`), and two-way analog multiplexers (`MUX`). A full suite of tests demonstrates functionality of each of the modules, showing waveform outputs for each of the VCO outputs and demonstrating basic exponential FM and linear AM. 

## Rack

`Rack` is responsible for storing modules and managing connections between them. It also manages mixing and stores the output buffer. Racks store modules using an associative map with a unique name as key and `unique_ptr` to a module object as value. This allows for efficient lookup and constant-time iteration through the module list. Connections are stored using an associative map, with an output module's name and output ID as keys and module name and input ID as values. `Rack` has a `process` method that will iterate through the computation graph, sending output values from one module to another. It then calls each module's `process` method and stores this value in the output buffer. Since the buffer updates occur sequentially, the connection latency between any two modules is only a single sample. 

## Modules

`Module` is a base class designed to 

### VCO
#### A voltage controlled saw-core FM oscillator

`VCO` is a standard oscillator, with outputs for `saw`, `tri`, `sin`, and `sqr` waves. The oscillator follows the typical 1V / octave standard, so a value of `1.0` present at the `FM` input will result in a tone exactly 1 octave above the fundamental. An optional `FM_INDEX` parameter allows dynamic scaling of FM values. The constructor for `VCO` takes a single value specifying the intial frequency. 

Inputs: `fm`, `

Outputs: `sin`, `sqr`, and `tri`

![waveforms](./output_waveforms.png)

## Next Steps

It would be worthwhile to test alternative implementations for storing modules and their connections. Even just using vectors might end up being more efficient due to the linear memory layout. This libarary lacks any front end implementation, but it would be relatively straightforward to augment it with a simple parser to process user input and create a realtime interactive synthesizer with a TUI or GUI. 