
all:
	llvm-g++ -Wall -std=c++17 -D__MACOSX_CORE__ -lncurses -o egress Main.cpp RtAudio.cpp -framework CoreAudio -framework CoreFoundation -lpthread

debug:
	llvm-g++ -Wall -std=c++17 -D__MACOSX_CORE__ -lncurses -o egress Main.cpp RtAudio.cpp -framework CoreAudio -framework CoreFoundation -lpthread
