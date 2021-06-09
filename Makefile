CXX = llvm-g++
CXXFLAGS = -Wall -std=c++17 -D__MACOSX_CORE__
LDFLAGS = -framework CoreAudio -framework CoreFoundation -lpthread -lncurses

all:
	$(CXX) $(CXXFLAGS) -o egress Main.cpp lib/RtAudio.cpp $(LDFLAGS)

debug:
	$(CXX) $(CXXFLAGS) -DDEBUG -o test/egress test/Test.cpp lib/RtAudio.cpp $(LDFLAGS)
