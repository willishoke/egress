UNAME := $(shell uname)
RTAUDIO_DIR = lib/rtaudio
RTAUDIO_SRC = $(RTAUDIO_DIR)/RtAudio.cpp

ifeq ($(UNAME), Linux)
CXX = g++
CXXFLAGS = -Wall -std=c++17 -D__LINUX_ALSA__ -isystem $(RTAUDIO_DIR)
LDFLAGS = -lasound -lpthread -lncurses

all:
	$(CXX) $(CXXFLAGS) -o egress Main.cpp $(RTAUDIO_SRC) $(LDFLAGS)

debug:
	$(CXX) $(CXXFLAGS) -DDEBUG -o test/egress test/Test.cpp  $(RTAUDIO_SRC) $(LDFLAGS)

endif

ifeq ($(UNAME), Darwin)
CXX = llvm-g++
CXXFLAGS = -Wall -std=c++17 -D__MACOSX_CORE__ -isystem $(RTAUDIO_DIR)
LDFLAGS = -framework CoreAudio -framework CoreFoundation -lpthread -lncurses

all:
	$(CXX) $(CXXFLAGS) -o egress Main.cpp $(RTAUDIO_SRC) $(LDFLAGS)

debug:
	$(CXX) $(CXXFLAGS) -DDEBUG -o test/egress test/Test.cpp $(RTAUDIO_SRC) $(LDFLAGS)
endif
