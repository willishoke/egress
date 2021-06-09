import sys
import numpy as np
import matplotlib.pyplot as plt

fname = sys.argv[1]

data = np.genfromtxt(fname, delimiter=' ')
print(data)

cos = data[0::5]
sin = data[1::5]
tri = data[2::5]
sqr = data[3::5]
saw = data[4::5]

legend = ["sine", "traingle", "square", "saw"]

for x in cos, sin, tri, sqr, saw:
    plt.plot(x)

plt.title("Output Waveforms")
plt.show()
plt.savefig("output_waveforms")
