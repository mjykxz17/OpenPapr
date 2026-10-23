import type { DeckSource } from "./pdf";

// The demo's slide decks, as text. scripts/make-demo-decks.ts turns each into
// src/demo/decks/<stem>.pdf; the seed files them under their module, and the
// study guides cite their pages. Everything here is made up for the demo but
// accurate: a student could revise from it. Page 1 of every deck is a cover,
// so slides[i] is page i + 2.
//
// Text stays within Helvetica's WinAnsi characters ("Theta", "<=", "^"),
// since the decks use the standard fonts rather than embedding one.

export type DemoDeck = DeckSource & { stem: string; module: string; category: "slides" | "tutorial" };

const s = (title: string, ...bullets: string[]) => ({ title, bullets });

export const DEMO_DECK_SOURCES: DemoDeck[] = [
  {
    stem: "L1-asymptotics", module: "CS3230", category: "slides",
    title: "Asymptotic analysis", subtitle: "CS3230 · Lecture 1", footer: "CS3230 L1 Asymptotics",
    slides: [
      s("Why count steps?", "Wall-clock time depends on the machine and the compiler", "Count basic operations instead", "Focus on how the count grows as n becomes large"),
      s("Input size and cases", "n = number of items, bits or vertices", "Worst case, best case, average case", "We usually analyse the worst case"),
      s("Growth rates", "1 < log n < n < n log n < n^2 < 2^n < n!", "Constant factors are dropped", "Lower-order terms are dropped"),
      s("Big-O", "f(n) = O(g(n)) if there are c > 0 and n0 with f(n) <= c*g(n) for all n >= n0", "An upper bound on growth", "Example: 3n^2 + n is O(n^2), with c = 4 and n0 = 1"),
      s("Big-Omega", "f(n) = Omega(g(n)) if f(n) >= c*g(n) for all n >= n0", "A lower bound on growth", "Example: n log n is Omega(n)"),
      s("Big-Theta", "f(n) = Theta(g(n)) if f is both O(g) and Omega(g)", "A tight bound", "Example: 5n + 2 is Theta(n)", "Theta is a claim about BOTH bounds"),
      s("The three bounds", "O(g): grows no faster than g", "Omega(g): grows at least as fast as g", "Theta(g): both at once"),
      s("Proving a bound", "Pick constants c and n0", "Show the inequality for every n >= n0", "Common mistake: letting c depend on n"),
      s("Little-o and little-omega", "Strict versions of O and Omega", "f = o(g): f grows strictly slower than g", "n = o(n^2), but n is not o(n)"),
      s("Comparing growth rates", "Take the limit of f(n)/g(n) as n grows", "0 means f = o(g); a positive constant means Theta", "Infinity means f = omega(g)"),
      s("Logarithms", "log_a n = Theta(log_b n) for constants a, b > 1", "So the base does not matter inside O", "n^0.001 eventually beats log n"),
      s("Polynomials vs exponentials", "n^k = o(2^n) for any constant k", "2^n = o(3^n)", "n! grows faster than 2^n"),
      s("Sums", "1 + 2 + ... + n = Theta(n^2)", "1 + 1/2 + ... + 1/n = Theta(log n)", "A geometric sum is dominated by its largest term"),
      s("Summary", "Count operations, not seconds", "Use O, Omega and Theta precisely", "Next: recurrences"),
    ],
  },
  {
    stem: "L3-divide-conquer", module: "CS3230", category: "slides",
    title: "Divide and conquer", subtitle: "CS3230 · Lecture 3", footer: "CS3230 L3 Divide and conquer",
    slides: [
      s("Recap", "Recurrences describe recursive running times", "Today: designing recursive algorithms"),
      s("Divide, conquer, combine", "Divide the problem into smaller parts", "Conquer each part recursively", "Combine the answers"),
      s("Example: merge sort", "Split the array in half", "Sort each half recursively", "Merge the two sorted halves"),
      s("Merging", "Walk both halves with two pointers", "Take the smaller head each time", "Theta(n) for n elements in total"),
      s("Correctness", "Induction on the array length", "Base case: one element is sorted", "Merging two sorted halves gives a sorted array"),
      s("Recursion tree", "Each level does Theta(n) work in total", "Sizes n, n/2, n/4, ..., 1", "log2 n + 1 levels"),
      s("Merge sort as a recurrence", "T(n) = 2T(n/2) + Theta(n)", "Solves to T(n) = Theta(n log n)", "Matches the recursion tree"),
      s("Example: binary search", "T(n) = T(n/2) + Theta(1)", "T(n) = Theta(log n)"),
      s("Example: Karatsuba", "Multiply two n-digit numbers with 3 half-size products, not 4", "T(n) = 3T(n/2) + Theta(n)", "Theta(n^1.585) instead of Theta(n^2)"),
      s("When is it worth it?", "The parts must be independent", "Combining must be cheap", "Overlapping parts: try dynamic programming"),
      s("Summary", "Divide, conquer, combine", "Write the recurrence, then solve it", "Next: the master theorem"),
    ],
  },
  {
    stem: "L4-master", module: "CS3230", category: "slides",
    title: "The master theorem", subtitle: "CS3230 · Lecture 4", footer: "CS3230 L4 Master theorem",
    slides: [
      s("Recurrences of one shape", "T(n) = aT(n/b) + f(n)", "a subproblems, each of size n/b", "f(n): the work to divide and combine"),
      s("The critical exponent", "Compare f(n) with n^(log_b a)", "n^(log_b a) counts the leaves of the recursion tree"),
      s("Case 1", "If f(n) = O(n^(log_b a - e)) for some e > 0", "then T(n) = Theta(n^(log_b a))", "The leaves dominate"),
      s("Case 2", "If f(n) = Theta(n^(log_b a))", "then T(n) = Theta(n^(log_b a) log n)", "Every level costs the same"),
      s("Case 3", "If f(n) = Omega(n^(log_b a + e)) for some e > 0, and a f(n/b) <= c f(n) for some c < 1", "then T(n) = Theta(f(n))", "The root dominates"),
      s("The theorem on one slide", "For T(n) = aT(n/b) + f(n), compare f(n) with n^(log_b a)", "f polynomially smaller: Theta(n^(log_b a))", "f the same: Theta(n^(log_b a) log n)", "f polynomially larger, and regular: Theta(f(n))"),
      s("Examples", "2T(n/2) + n: Case 2, Theta(n log n)", "8T(n/2) + n^2: Case 1, Theta(n^3)", "2T(n/2) + n^2: Case 3, Theta(n^2)"),
      s("When it does not apply", "T(n) = 2T(n/2) + n log n falls in the gap between Cases 2 and 3", "Use the recursion tree or substitution instead"),
      s("Summary", "Find a, b and f", "Compare f(n) with n^(log_b a)", "Pick the case; check regularity for Case 3"),
    ],
  },
  {
    stem: "L6-amortised", module: "CS3230", category: "slides",
    title: "Amortised analysis", subtitle: "CS3230 · Lecture 6", footer: "CS3230 L6 Amortised analysis",
    slides: [
      s("Why amortise?", "Some operations are expensive, but rarely", "Worst case per operation is too pessimistic for a whole sequence"),
      s("Amortised cost", "The average cost per operation over a worst-case sequence of operations", "Not an average over random inputs: no probability is involved"),
      s("Aggregate method", "Bound the total cost T(n) of n operations", "Amortised cost = T(n)/n"),
      s("Binary counter", "Bit i flips once every 2^i increments", "Total flips over n increments < 2n", "Amortised O(1) per increment"),
      s("Stack with multipop", "Each element is pushed once and popped at most once", "n operations cost O(n) in total", "O(1) amortised per operation"),
      s("Accounting method", "Charge each operation an amortised cost", "Store the extra as credit on the data structure", "Expensive operations spend the credit"),
      s("Credit invariant", "Credit must never go negative", "Prove it holds after every operation"),
      s("Potential method", "Phi maps each state of the data structure to a number", "Amortised cost = actual cost + change in Phi", "Phi starts at 0 and never goes negative"),
      s("Example: dynamic array", "Double the capacity when the array is full", "Copying costs n, but only after about n cheap appends"),
      s("Dynamic array, accounting", "Charge 3 per append", "1 pays for the append, 2 are saved for future copies", "O(1) amortised per append"),
      s("Summary", "Aggregate, accounting, potential", "All three give the same bound when done right"),
    ],
  },
  {
    stem: "Tutorial 3", module: "CS3230", category: "tutorial",
    title: "Tutorial 3", subtitle: "CS3230 · Divide and conquer", footer: "CS3230 Tutorial 3",
    slides: [
      s("Questions", "Q1. Solve T(n) = 4T(n/2) + n with the master theorem", "Q2. Solve T(n) = T(n/3) + T(2n/3) + n with a recursion tree", "Q3. Count the inversions in an array in O(n log n)"),
      s("Hints", "Q1: compare n with n^(log_2 4)", "Q2: the tree is lopsided; bound its depth", "Q3: count while merging"),
    ],
  },
  {
    stem: "L6-design-principles", module: "CS2103T", category: "slides",
    title: "Design principles", subtitle: "CS2103T · Lecture 6", footer: "CS2103T L6 Design principles",
    slides: [
      s("Why design principles?", "Code is changed far more often than it is written from scratch", "Good design keeps each change small and local"),
      s("Coupling", "Coupling is how much one component depends on others", "High coupling: a change in one class forces changes in others", "Aim for low coupling"),
      s("Cohesion", "Cohesion is how strongly the parts of one component belong together", "High cohesion: a class does one job, and does it well", "Aim for high cohesion"),
      s("SOLID at a glance", "S: Single Responsibility Principle", "O: Open-Closed Principle", "L: Liskov Substitution Principle", "I: Interface Segregation Principle", "D: Dependency Inversion Principle"),
      s("Single Responsibility", "A class should have only one reason to change", "Example: keep Storage and Parser apart, not one class that does both"),
      s("Open-Closed", "Open for extension, closed for modification", "Add new behaviour by adding code, not by editing code that works", "Usually done with polymorphism: interfaces and abstract classes"),
      s("Liskov Substitution", "A subclass object must work wherever its superclass is expected", "A subclass must not demand more or promise less than its superclass", "Classic violation: Square extends Rectangle"),
      s("Interface Segregation", "No client should be forced to depend on methods it does not use", "Prefer several small interfaces to one large one"),
      s("Dependency Inversion", "High-level modules should not depend on low-level modules; both should depend on abstractions", "Example: Logic depends on a Storage interface, not on JsonStorage"),
      s("Summary", "Low coupling, high cohesion", "SOLID: five principles for code that is easy to change", "Next: design patterns"),
    ],
  },
  {
    stem: "L4-reliable-transfer", module: "CS2105", category: "slides",
    title: "Reliable data transfer", subtitle: "CS2105 · Lecture 4", footer: "CS2105 L4 Reliable transfer",
    slides: [
      s("The problem", "The network layer may corrupt, lose or reorder packets", "The transport layer must still deliver the data correctly and in order"),
      s("The tools", "Checksums detect corrupted packets", "ACKs tell the sender what arrived", "Sequence numbers spot duplicates", "Timers recover lost packets"),
      s("Stop-and-wait (rdt 3.0)", "Send one packet, then wait for its ACK", "Retransmit when the timer expires", "A 1-bit sequence number (0, 1) is enough"),
      s("Stop-and-wait is slow", "Utilisation U = (L/R) / (RTT + L/R)", "L = 8000 bits, R = 1 Gbps, RTT = 30 ms gives U = 0.00027", "The link sits idle while the sender waits"),
      s("Pipelining", "Let several unACKed packets be in flight at once", "Needs a range of sequence numbers and buffering", "Two ways to do it: Go-Back-N and Selective Repeat"),
      {
        title: "Go-Back-N: the sender",
        bullets: ["Up to N unACKed packets in the window", "Cumulative ACK: ACK n means every packet up to n arrived", "One timer, for the oldest unACKed packet", "On timeout, resend every packet in the window"],
        figure: {
          kind: "boxes",
          boxes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => ({ label: String(n), tone: n < 3 ? "done" : n < 6 ? "sent" : n < 7 ? "free" : "off" })),
          legend: [{ tone: "done", label: "ACKed" }, { tone: "sent", label: "sent, not yet ACKed" }, { tone: "free", label: "usable" }, { tone: "off", label: "not usable" }],
        },
      },
      s("Go-Back-N: the receiver", "Accepts only the next in-order packet", "Discards out-of-order packets and buffers nothing", "Re-sends the ACK for the last in-order packet"),
      s("Go-Back-N in action", "Window N = 4; packet 2 is lost", "Packets 3, 4 and 5 arrive out of order and are discarded; the receiver repeats ACK 1", "Timeout: the sender resends 2, 3, 4 and 5"),
      s("Selective Repeat", "The receiver ACKs and buffers each packet on its own", "The sender keeps a timer per packet and resends only the lost ones", "The window must be at most half the sequence number space"),
      s("Summary", "Checksums, ACKs, sequence numbers and timers", "Pipelining fixes the utilisation of stop-and-wait", "GBN: simple receiver, more resending", "SR: less resending, more buffering"),
    ],
  },
  {
    stem: "L3-conditional-probability", module: "ST2334", category: "slides",
    title: "Conditional probability and Bayes' theorem", subtitle: "ST2334 · Lecture 3", footer: "ST2334 L3 Conditional probability",
    slides: [
      s("Conditional probability", "P(A | B) = P(A and B) / P(B), for P(B) > 0", "The probability of A once we know B has happened", "B becomes the new sample space"),
      s("Example: two dice", "B: the sum is 8, so (2,6), (3,5), (4,4), (5,3) or (6,2)", "A: both dice show the same number", "P(A | B) = 1/5, while P(A) = 6/36 = 1/6"),
      s("Multiplication rule", "P(A and B) = P(A | B) P(B) = P(B | A) P(A)", "Chain rule: P(A1 A2 A3) = P(A1) P(A2 | A1) P(A3 | A1 A2)"),
      s("Law of total probability", "If B1, ..., Bk partition the sample space:", "P(A) = P(A | B1) P(B1) + ... + P(A | Bk) P(Bk)", "Split a hard probability into easy cases"),
      s("Bayes' theorem", "P(B | A) = P(A | B) P(B) / P(A)", "Turns P(evidence | cause) into P(cause | evidence)", "Expand P(A) with the law of total probability"),
      s("Example: a medical test", "1% of people have the disease", "The test is positive for 95% of those who have it, and for 5% of those who do not", "P(positive) = 0.95(0.01) + 0.05(0.99) = 0.059", "P(disease | positive) = 0.0095 / 0.059 = 0.161, about 16%"),
      s("The base-rate fallacy", "A positive result from an accurate test can still leave the disease unlikely", "When the condition is rare, false positives outnumber true positives"),
      s("Independence", "A and B are independent if P(A and B) = P(A) P(B)", "Equivalently P(A | B) = P(A), when P(B) > 0", "Independent is not the same as mutually exclusive"),
      s("Summary", "Conditioning: restrict to B and rescale", "Total probability: split into cases", "Bayes: reverse the conditioning"),
    ],
  },
];

export const DEMO_DECKS = DEMO_DECK_SOURCES.map((d) => d.stem);

// Pages in a deck, the cover included.
export const deckPages = (d: DemoDeck) => d.slides.length + 1;

