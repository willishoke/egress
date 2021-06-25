UNAME := $(shell uname)

ifeq ($(UNAME), Linux)
CXX = g++
CXXFLAGS = -Wall -std=c++17 -D__LINUX_ALSA__
LDFLAGS = -lasound -lpthread -lncurses

all:
	$(CXX) $(CXXFLAGS) -o egress Main.cpp lib/RtAudio.cpp $(LDFLAGS)

debug:
	$(CXX) $(CXXFLAGS) -DDEBUG -o test/egress test/Test.cpp lib/RtAudio.cpp $(LDFLAGS)

endif

ifeq ($(UNAME), Darwin)
CXX = llvm-g++
CXXFLAGS = -Wall -std=c++17 -D__MACOSX_CORE__
LDFLAGS = -framework CoreAudio -framework CoreFoundation -lpthread -lncurses

all:
	$(CXX) $(CXXFLAGS) -o egress Main.cpp lib/RtAudio.cpp $(LDFLAGS)

debug:
	$(CXX) $(CXXFLAGS) -DDEBUG -o test/egress test/Test.cpp lib/RtAudio.cpp $(LDFLAGS)
endif
