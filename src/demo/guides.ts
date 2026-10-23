import type { QuizQuestion } from "../server/guide-quiz";
import { citeDeck } from "../lib/slide-citation";

// The demo's study guides, one per module, and the practice questions for
// each chapter, written by hand so a visitor never waits on (or pays for) a
// model. Every slide link is made with `cite`, which also records the words
// the cited page must show; src/demo/decks.test.ts reads them back out of
// the PDFs, so a guide can't point at a slide that doesn't say what it claims.

export type Citation = { module: string; deck: string; page: number; says: string };
export type DemoGuide = { module: string; markdown: string; quizzes: QuizQuestion[][] };

export const DEMO_CITATIONS: Citation[] = [];

// "[L4 p7](slide:L4-master#7)", noting that page 7 of L4-master says `says`.
function citer(module: string) {
  return (deck: string, page: number, says: string) => {
    DEMO_CITATIONS.push({ module, deck, page, says });
    const short = /^(L\d+)/.exec(deck)?.[1] ?? deck.replace(/^Tutorial\s*/i, "T");
    return `[${short} p${page}](slide:${citeDeck(deck)}#${page})`;
  };
}

const q = (question: string, options: string[], answer: number, why: string, deck: string, page: number): QuizQuestion =>
  ({ q: question, options, answer, why, slide: { deck, page } });

// --- CS3230 ------------------------------------------------------------------
const c1 = citer("CS3230");
const L1 = "L1-asymptotics", L3 = "L3-divide-conquer", L4 = "L4-master", L6 = "L6-amortised";
const cs3230 = `# CS3230 — Study guide

How to analyse an algorithm's running time, and three ways to design one that is fast.

## 1. Asymptotic analysis

Big-O, Ω and Θ describe how running time grows as n gets large: constant factors and lower-order terms are dropped. ${c1(L1, 4, "Constant factors are dropped")}

### The three bounds

| Notation | Means | Example |
| --- | --- | --- |
| O(g) | grows no faster than g | 3n² + n is O(n²) |
| Ω(g) | grows at least as fast as g | n log n is Ω(n) |
| Θ(g) | both at once | 5n + 2 is Θ(n) |

The three side by side are on ${c1(L1, 8, "Omega(g): grows at least as fast as g")}; for 3n² + n, the constants c = 4 and n0 = 1 prove the O bound. ${c1(L1, 5, "3n^2 + n is O(n^2), with c = 4 and n0 = 1")}

> **Exam tip.** Θ is a claim about *both* bounds. Proving only the upper bound gives you O, not Θ. ${c1(L1, 7, "Theta is a claim about BOTH bounds")}

### Proving a bound

Pick c and n0 first, then show the inequality for every n ≥ n0. The usual mistake is letting c depend on n. ${c1(L1, 9, "Common mistake: letting c depend on n")}

### Comparing growth rates

Take the limit of f(n)/g(n). If it is 0, f is o(g); a positive constant means Θ; infinity means ω. ${c1(L1, 11, "0 means f = o(g); a positive constant means Theta")}

## 2. Divide and conquer

Split the problem, solve the parts recursively, combine the answers. ${c1(L3, 3, "Combine the answers")}

### Merge sort as a recurrence

\`\`\`mermaid
flowchart TD
  A["sort(A[1..n])"] --> B["sort left half"]
  A --> C["sort right half"]
  B --> D["merge: Θ(n)"]
  C --> D
\`\`\`

Merging the two sorted halves takes Θ(n) ${c1(L3, 5, "Theta(n) for n elements in total")}, so the running time satisfies T(n) = 2T(n/2) + Θ(n), which solves to Θ(n log n). ${c1(L3, 8, "Solves to T(n) = Theta(n log n)")}

### The master theorem

For T(n) = aT(n/b) + f(n), compare f(n) with n^(log_b a): ${c1(L4, 7, "compare f(n) with n^(log_b a)")}

- **Case 1:** f is polynomially smaller, so T(n) = Θ(n^(log_b a)).
- **Case 2:** they match, so T(n) = Θ(n^(log_b a) · log n).
- **Case 3:** f is polynomially larger (and regular), so T(n) = Θ(f(n)).

For example, 8T(n/2) + n² is Case 1 and solves to Θ(n³). ${c1(L4, 8, "8T(n/2) + n^2: Case 1, Theta(n^3)")} A recurrence like 2T(n/2) + n log n falls between the cases; use a recursion tree instead. ${c1(L4, 9, "falls in the gap between Cases 2 and 3")}

## 3. Amortised analysis

The average cost per operation over a worst-case sequence, even when single operations are expensive. It is not an average over random inputs. ${c1(L6, 3, "The average cost per operation over a worst-case sequence of operations")}

### The accounting method

Charge each cheap operation a little extra and store it as credit; expensive operations spend the credit. ${c1(L6, 7, "Store the extra as credit on the data structure")} The credit must never go negative. ${c1(L6, 8, "Credit must never go negative")}

A dynamic array that doubles when full costs O(1) amortised per append: charge 3, one pays for the append and two are saved for future copies. ${c1(L6, 11, "1 pays for the append, 2 are saved for future copies")}

### The potential method

The amortised cost is the actual cost plus the change in a potential Φ, which starts at 0 and never goes negative. ${c1(L6, 9, "Amortised cost = actual cost + change in Phi")}
`;
const cs3230Quizzes: QuizQuestion[][] = [
  [
    q("Which statement about f(n) = 3n² + n is correct?", ["It is O(n²) but not Θ(n²)", "It is Θ(n²)", "It is O(n)", "It is Ω(n³)"], 1,
      "3n² + n ≤ 4n² for n ≥ 1 gives O(n²), and 3n² + n ≥ n² gives Ω(n²), so it is Θ(n²).", L1, 5),
    q("You have shown f(n) ≤ c·g(n) for every n ≥ n0. What have you proved?", ["f = Θ(g)", "f = O(g)", "f = Ω(g)", "f(n) = g(n) for large n"], 1,
      "An upper bound alone gives O. Θ needs the lower bound as well.", L1, 7),
    q("As n grows, f(n)/g(n) tends to 5. What follows?", ["f = o(g)", "f = ω(g)", "f = Θ(g)", "Nothing: the limit test needs 0 or infinity"], 2,
      "A positive constant limit means f and g grow at the same rate, so f = Θ(g).", L1, 11),
    q("Which of these is a mistake when proving f = O(g)?", ["Choosing c before n0", "Choosing c = 100", "Letting c depend on n", "Showing the inequality only for n ≥ n0"], 2,
      "c must be a constant. If it depends on n, the inequality proves nothing about growth.", L1, 9),
    q("Which statement is true?", ["n log n is Ω(n)", "n is Ω(n log n)", "log n is Ω(n)", "n is Ω(n²)"], 0,
      "n log n ≥ n for n ≥ 2, so n log n grows at least as fast as n.", L1, 8),
  ],
  [
    q("Merge sort satisfies T(n) = 2T(n/2) + Θ(n). What does that solve to?", ["Θ(n)", "Θ(n log n)", "Θ(n²)", "Θ(log n)"], 1,
      "Each of the log n levels of the recursion tree does Θ(n) work.", L3, 8),
    q("Which case of the master theorem applies to T(n) = 8T(n/2) + n²?", ["Case 1: Θ(n³)", "Case 2: Θ(n² log n)", "Case 3: Θ(n²)", "It does not apply"], 0,
      "n^(log_2 8) = n³, and n² is polynomially smaller, so the leaves dominate.", L4, 8),
    q("In the master theorem, what do you compare f(n) with?", ["n^(log_b a)", "a · b", "log n", "f(n/b)"], 0,
      "n^(log_b a) counts the leaves of the recursion tree; the case depends on how f(n) compares with it.", L4, 7),
    q("Why can't the basic master theorem solve T(n) = 2T(n/2) + n log n?", ["a is not a power of b", "n log n is larger than n, but not polynomially larger", "b must be greater than 2", "The recurrence has no base case"], 1,
      "It falls in the gap between Cases 2 and 3, so a recursion tree or substitution is needed.", L4, 9),
    q("How long does merging two sorted halves of n elements in total take?", ["Θ(log n)", "Θ(n)", "Θ(n log n)", "Θ(n²)"], 1,
      "Two pointers walk the halves once, taking the smaller head each time.", L3, 5),
  ],
  [
    q("What does an amortised cost average over?", ["Random inputs", "A worst-case sequence of operations", "The best and the worst case", "Every possible data structure"], 1,
      "It is a worst-case guarantee for a whole sequence; no probability is involved.", L6, 3),
    q("In the accounting method, what must always hold?", ["Every operation costs O(1)", "The stored credit never goes negative", "Expensive operations are charged the most", "Credit is spent straight away"], 1,
      "If the credit stayed non-negative, the amortised charges cover the real cost.", L6, 8),
    q("A doubling dynamic array charges 3 per append. What are the extra 2 for?", ["Future copies when the array grows", "Deleting elements", "The very first append", "Shrinking the array"], 0,
      "1 pays for the append itself and 2 are saved for the copying that a resize will need.", L6, 11),
    q("In the potential method, the amortised cost of an operation is…", ["the actual cost minus Φ", "the actual cost plus the change in Φ", "Φ of the final state", "the average actual cost"], 1,
      "Amortised = actual + ΔΦ; cheap operations raise Φ to pay for expensive ones later.", L6, 9),
  ],
];

// --- CS2103T -----------------------------------------------------------------
const c2 = citer("CS2103T");
const DP = "L6-design-principles";
const cs2103t = `# CS2103T — Study guide

Design principles: how to keep code easy to change as the team project grows.

## 1. Coupling and cohesion

Code is changed far more often than it is written from scratch, so good design keeps each change small and local. ${c2(DP, 2, "Good design keeps each change small and local")}

### Coupling

Coupling is how much one component depends on others. When it is high, a change in one class forces changes in others, so aim for low coupling. ${c2(DP, 3, "a change in one class forces changes in others")}

### Cohesion

Cohesion is how strongly the parts of one component belong together. A cohesive class does one job, and does it well. ${c2(DP, 4, "a class does one job, and does it well")}

> **Exam tip.** The two go together: aim for low coupling *and* high cohesion. ${c2(DP, 11, "Low coupling, high cohesion")}

## 2. The SOLID principles

Five principles for code that is easy to change. ${c2(DP, 5, "S: Single Responsibility Principle")}

| Letter | Principle | In one line |
| --- | --- | --- |
| S | Single Responsibility | one reason to change |
| O | Open-Closed | extend without editing code that works |
| L | Liskov Substitution | a subclass works wherever its superclass does |
| I | Interface Segregation | small interfaces, no unused methods |
| D | Dependency Inversion | depend on abstractions |

### Single Responsibility

A class should have only one reason to change: keep Storage and Parser apart rather than one class that does both. ${c2(DP, 6, "A class should have only one reason to change")}

### Open-Closed

Open for extension, closed for modification: add behaviour by adding code, usually through interfaces or abstract classes. ${c2(DP, 7, "Open for extension, closed for modification")}

### Liskov Substitution

A subclass object must work wherever its superclass is expected. The classic violation is Square extending Rectangle. ${c2(DP, 8, "Classic violation: Square extends Rectangle")} Code that sets a rectangle's width and expects the height to stay put breaks when it is handed a square.

### Interface Segregation

No client should be forced to depend on methods it does not use, so prefer several small interfaces to one large one. ${c2(DP, 9, "forced to depend on methods it does not use")}

### Dependency Inversion

High-level modules should not depend on low-level ones; both should depend on abstractions. In the project, Logic depends on a Storage interface rather than on JsonStorage. ${c2(DP, 10, "Logic depends on a Storage interface")}
`;
const cs2103tQuizzes: QuizQuestion[][] = [
  [
    q("A change to the Storage class forces edits in Logic, Ui and Parser. What does that show?", ["High cohesion", "High coupling", "Low coupling", "Good encapsulation"], 1,
      "When a change in one class forces changes in others, the classes are tightly coupled.", DP, 3),
    q("Which class is the most cohesive?", ["One that parses commands and also saves files", "One that does one job, and does it well", "One that every other class depends on", "One with many unrelated helper methods"], 1,
      "Cohesion is how strongly a component's parts belong together; one clear job is the sign of it.", DP, 4),
    q("What should a design aim for?", ["High coupling, high cohesion", "Low coupling, low cohesion", "Low coupling, high cohesion", "High coupling, low cohesion"], 2,
      "Low coupling keeps changes local; high cohesion keeps each class focused.", DP, 11),
    q("Why do design principles matter so much?", ["Code is changed far more often than it is written from scratch", "They make programs run faster", "They reduce the number of classes", "They remove the need for tests"], 0,
      "Good design keeps each of those many changes small and local.", DP, 2),
  ],
  [
    q("Which principle says a class should have only one reason to change?", ["Single Responsibility", "Open-Closed", "Liskov Substitution", "Dependency Inversion"], 0,
      "That is the Single Responsibility Principle, the S in SOLID.", DP, 6),
    q("You add a command by writing a new class that implements Command, without editing the existing ones. Which principle is that?", ["Single Responsibility", "Open-Closed", "Interface Segregation", "Liskov Substitution"], 1,
      "The code was extended without being modified: open for extension, closed for modification.", DP, 7),
    q("Square extends Rectangle breaks which principle?", ["Dependency Inversion", "Interface Segregation", "Liskov Substitution", "Open-Closed"], 2,
      "A Square can't stand in everywhere a Rectangle is expected, which is what Liskov Substitution requires.", DP, 8),
    q("Logic depends on a Storage interface rather than on JsonStorage. Which principle is that?", ["Dependency Inversion", "Single Responsibility", "Open-Closed", "Liskov Substitution"], 0,
      "Both the high-level Logic and the low-level JsonStorage depend on the Storage abstraction.", DP, 10),
    q("A class must implement ten methods of an interface but uses only two. What should change?", ["Split the interface into smaller ones", "Make the class abstract", "Merge the interface with another", "Add default methods that return null"], 0,
      "Interface Segregation: no client should depend on methods it does not use.", DP, 9),
  ],
];

// --- CS2105 ------------------------------------------------------------------
const c3 = citer("CS2105");
const RT = "L4-reliable-transfer";
const cs2105 = `# CS2105 — Study guide

How the transport layer delivers data reliably over a network that loses and corrupts packets.

## 1. Reliable transfer basics

The network layer may corrupt, lose or reorder packets, yet the transport layer must deliver the data correctly and in order. ${c3(RT, 2, "The network layer may corrupt, lose or reorder packets")}

### Four tools

| Tool | Deals with |
| --- | --- |
| Checksum | corrupted packets |
| ACK | telling the sender what arrived |
| Sequence number | duplicates |
| Timer | lost packets |

Each of the four is on one slide. ${c3(RT, 3, "Timers recover lost packets")}

### Stop-and-wait

Send one packet and wait for its ACK, retransmitting when the timer expires; a 1-bit sequence number is enough. ${c3(RT, 4, "A 1-bit sequence number (0, 1) is enough")}

It is correct but slow. Utilisation is U = (L/R) / (RTT + L/R): with L = 8000 bits, R = 1 Gbps and RTT = 30 ms, U is only 0.00027. ${c3(RT, 5, "RTT = 30 ms gives U = 0.00027")}

## 2. Go-Back-N and Selective Repeat

Pipelining lets several unACKed packets be in flight at once. ${c3(RT, 6, "Let several unACKed packets be in flight at once")}

### Go-Back-N

![The Go-Back-N sender's window](slide-img:${RT}#7)

The sender keeps up to N unACKed packets, uses cumulative ACKs and one timer, and on a timeout resends the whole window. ${c3(RT, 7, "On timeout, resend every packet in the window")} The receiver accepts only the next in-order packet and discards the rest. ${c3(RT, 8, "Discards out-of-order packets and buffers nothing")}

> **Worked example.** The window is N = 4 and packet 2 is lost. Packets 3, 4 and 5 are discarded and the receiver repeats ACK 1; at the timeout the sender resends 2, 3, 4 and 5. ${c3(RT, 9, "the sender resends 2, 3, 4 and 5")}

### Selective Repeat

The receiver ACKs and buffers each packet on its own, so the sender resends only the lost ones, with a timer per packet. The window must be at most half the sequence number space. ${c3(RT, 10, "at most half the sequence number space")}

| | Go-Back-N | Selective Repeat |
| --- | --- | --- |
| ACKs | cumulative | one per packet |
| Receiver buffers | nothing | out-of-order packets |
| After a loss, resends | the whole window | only the lost packet |

In short: Go-Back-N has the simpler receiver but resends more. ${c3(RT, 11, "GBN: simple receiver, more resending")}
`;
const cs2105Quizzes: QuizQuestion[][] = [
  [
    q("Which tool lets the receiver spot a duplicate packet?", ["Checksum", "Timer", "Sequence number", "Cumulative ACK"], 2,
      "A repeated sequence number shows the packet has been seen before.", RT, 3),
    q("Why is a 1-bit sequence number enough for stop-and-wait?", ["Only one packet is ever in flight", "Packets are never lost", "The checksum catches duplicates", "ACKs carry the full sequence number"], 0,
      "With one packet outstanding, the receiver only has to tell this packet from the previous one.", RT, 4),
    q("L = 8000 bits, R = 1 Gbps, RTT = 30 ms. Roughly what is stop-and-wait's utilisation?", ["0.27", "0.027", "0.00027", "0.5"], 2,
      "L/R is 0.008 ms, so U = 0.008 / 30.008 ≈ 0.00027: the link is idle almost all the time.", RT, 5),
    q("What does a timer recover from?", ["Corrupted packets", "Lost packets", "Reordered ACKs", "Duplicate packets"], 1,
      "If no ACK comes back before the timer expires, the packet is presumed lost and resent.", RT, 3),
  ],
  [
    q("In Go-Back-N, what does ACK n mean?", ["Packet n arrived; nothing is known about the others", "Every packet up to n arrived", "Send packet n again", "The window is now n packets"], 1,
      "Go-Back-N ACKs are cumulative.", RT, 7),
    q("A Go-Back-N receiver gets packet 4 while waiting for packet 2. What does it do?", ["Buffers 4 and ACKs it", "Discards 4 and re-sends the ACK for its last in-order packet", "Asks for packet 3", "Delivers 4 to the application"], 1,
      "It accepts only the next in-order packet and buffers nothing.", RT, 8),
    q("N = 4 and packet 2 is lost; packets 3 to 5 arrive. What does the sender resend at the timeout?", ["Only 2", "2 and 3", "2, 3, 4 and 5", "Nothing: the receiver kept them"], 2,
      "The receiver discarded 3, 4 and 5, so the whole window goes again.", RT, 9),
    q("In Selective Repeat, how large may the window be?", ["Any size", "At most half the sequence number space", "Exactly the sequence number space", "One packet"], 1,
      "Any larger and the receiver can't tell a new packet from a retransmitted old one.", RT, 10),
    q("Which protocol resends less after a loss?", ["Go-Back-N", "Selective Repeat", "Stop-and-wait", "They resend the same"], 1,
      "Selective Repeat resends only the lost packet, at the cost of buffering at the receiver.", RT, 11),
  ],
];

// --- ST2334 ------------------------------------------------------------------
const c4 = citer("ST2334");
const CP = "L3-conditional-probability";
const st2334 = `# ST2334 — Study guide

Conditional probability: how a probability changes once you know something has happened.

## 1. Conditional probability

P(A | B) = P(A and B) / P(B), for P(B) > 0: the probability of A once we know B has happened. B becomes the new sample space. ${c4(CP, 2, "B becomes the new sample space")}

### A worked example

Roll two dice. Given the sum is 8, there are five equally likely outcomes and one of them, (4,4), is a double. So P(double | sum is 8) = 1/5, while P(double) = 1/6. ${c4(CP, 3, "P(A | B) = 1/5, while P(A) = 6/36 = 1/6")}

### The multiplication rule

P(A and B) = P(A | B) P(B). For more events, chain it: P(A1 A2 A3) = P(A1) P(A2 | A1) P(A3 | A1 A2). ${c4(CP, 4, "Chain rule: P(A1 A2 A3) = P(A1) P(A2 | A1) P(A3 | A1 A2)")}

### Independence

A and B are independent if P(A and B) = P(A) P(B), or equivalently P(A | B) = P(A). ${c4(CP, 9, "A and B are independent if P(A and B) = P(A) P(B)")}

> **Exam tip.** Independent is not the same as mutually exclusive: two exclusive events with positive probabilities are never independent. ${c4(CP, 9, "Independent is not the same as mutually exclusive")}

## 2. Total probability and Bayes' theorem

### The law of total probability

If B1, …, Bk partition the sample space, then P(A) = P(A | B1) P(B1) + … + P(A | Bk) P(Bk): split a hard probability into easy cases. ${c4(CP, 5, "partition the sample space")}

### Bayes' theorem

P(B | A) = P(A | B) P(B) / P(A). It turns P(evidence | cause) into P(cause | evidence). ${c4(CP, 6, "Turns P(evidence | cause) into P(cause | evidence)")}

> **Worked example.** 1% of people have a disease; a test is positive for 95% of them and for 5% of everyone else. P(positive) = 0.059, so P(disease | positive) = 0.0095 / 0.059 ≈ 0.16. ${c4(CP, 7, "0.0095 / 0.059 = 0.161, about 16%")}

### The base-rate fallacy

When a condition is rare, false positives outnumber true positives, so even an accurate test can leave it unlikely. ${c4(CP, 8, "false positives outnumber true positives")}
`;
const st2334Quizzes: QuizQuestion[][] = [
  [
    q("Two dice are rolled and the sum is 8. What is the probability both show the same number?", ["1/6", "1/5", "1/36", "5/36"], 1,
      "Five outcomes sum to 8 and only (4,4) is a double.", CP, 3),
    q("What is P(A | B), by definition?", ["P(A) P(B)", "P(A and B) / P(B)", "P(A and B) / P(A)", "P(B | A) P(A)"], 1,
      "Restrict to B, then rescale by P(B).", CP, 2),
    q("A and B are mutually exclusive, each with probability 0.3. Are they independent?", ["Yes, always", "No: P(A and B) = 0 but P(A) P(B) = 0.09", "Only if P(B) > 0.5", "Yes, because they can't both happen"], 1,
      "Independence needs P(A and B) = P(A) P(B), and 0 is not 0.09.", CP, 9),
    q("By the multiplication rule, P(A and B) equals…", ["P(A | B) P(B)", "P(A) + P(B)", "P(A | B) / P(B)", "P(A) / P(B)"], 0,
      "Rearranging the definition of P(A | B) gives P(A and B) = P(A | B) P(B).", CP, 4),
  ],
  [
    q("Bayes' theorem gives P(B | A) as…", ["P(A | B) P(B) / P(A)", "P(A | B) P(A) / P(B)", "P(A) P(B)", "P(A and B) / P(B)"], 0,
      "It reverses the conditioning, with P(A) usually expanded by total probability.", CP, 6),
    q("1% of people have a disease; a test is positive for 95% of them and for 5% of everyone else. Roughly what is P(disease | positive)?", ["95%", "50%", "16%", "1%"], 2,
      "0.0095 / 0.059 ≈ 0.16.", CP, 7),
    q("Why is that answer so low?", ["The test is inaccurate", "False positives from the many healthy people outnumber the true positives", "The disease is contagious", "Bayes' theorem doesn't apply to tests"], 1,
      "When a condition is rare, most positives come from the large group without it.", CP, 8),
    q("For the law of total probability, what must B1, …, Bk do?", ["Be independent", "Partition the sample space", "Have equal probabilities", "Each contain A"], 1,
      "They must split the sample space into non-overlapping cases that cover it.", CP, 5),
  ],
];

export const DEMO_GUIDES: DemoGuide[] = [
  { module: "CS2103T", markdown: cs2103t, quizzes: cs2103tQuizzes },
  { module: "CS3230", markdown: cs3230, quizzes: cs3230Quizzes },
  { module: "CS2105", markdown: cs2105, quizzes: cs2105Quizzes },
  { module: "ST2334", markdown: st2334, quizzes: st2334Quizzes },
];
