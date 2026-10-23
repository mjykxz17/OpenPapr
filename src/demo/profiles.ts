import type { ModuleProfile, UserProfile } from "../enrich/profiles";

// What the demo shows on each module's About tab and on Account, written by
// hand: the real ones are built by a model, which the demo never calls. The
// weightings match the components the seed gives each module.

export type DemoModuleProfile = { lecturers: string[]; profile: ModuleProfile };

export const DEMO_MODULE_PROFILES: Record<string, DemoModuleProfile> = {
  CS2103T: {
    lecturers: ["Dr Priya Nair"],
    profile: {
      oneLine: "Building software in a team: object-oriented design, design principles, testing and a semester-long project.",
      covers: ["Object-oriented design", "Design principles (SOLID)", "Testing", "Git and code review", "Requirements and UML", "Team project"],
      assessment: "Team project 45%, final exam 30%, quizzes 15%, participation 10%",
      lecturers: [{ name: "Dr Priya Nair", background: null, emphasis: ["clean code", "design principles"] }],
      studentsSay: { workload: "Steady, with spikes before each project milestone", difficulty: "Moderate; the team project takes the most time", tips: ["Merge small pull requests often", "Do the weekly quiz right after the lecture"], pitfalls: ["Leaving integration to the night before a milestone"] },
      fit: { buildsOn: ["CS2030S programming methodology", "CS2040S data structures"], gaps: ["Writing tests with JUnit"], relevance: "Core for software engineering internships and most later project modules." },
      howToStudy: ["Apply each principle to your own project code", "Review a teammate's pull request every week", "Redo the weekly quiz questions you got wrong"],
    },
  },
  CS3230: {
    lecturers: ["Dr Lim Wei", "Prof Sarah Ong"],
    profile: {
      oneLine: "How to prove an algorithm correct and fast: asymptotics, divide and conquer, dynamic programming, greedy methods and amortised analysis.",
      covers: ["Asymptotic analysis", "Divide and conquer", "Dynamic programming", "Greedy algorithms", "Amortised analysis", "NP-completeness"],
      assessment: "Problem sets 30%, midterm 20%, final exam 50%",
      lecturers: [{ name: "Dr Lim Wei", background: "Works on approximation algorithms.", emphasis: ["rigorous proofs", "recurrences"] }, { name: "Prof Sarah Ong", background: null, emphasis: ["dynamic programming"] }],
      studentsSay: { workload: "Heavy in problem-set weeks", difficulty: "Hard but fair", tips: ["Start problem sets the day they are released", "Practise writing proofs, not just answers"], pitfalls: ["Leaving the master theorem to the week before the midterm"] },
      fit: { buildsOn: ["CS2040S data structures", "CS1231S discrete structures"], gaps: ["Induction proofs", "Summations"], relevance: "Core for the algorithms focus area and most technical interviews." },
      howToStudy: ["Redo tutorial questions without notes", "Keep a one-page sheet of recurrences and their solutions", "Explain each proof out loud before writing it"],
    },
  },
  CS2105: {
    lecturers: ["Prof Daniel Wong"],
    profile: {
      oneLine: "How the internet moves data: the application, transport and network layers, reliable transfer and socket programming.",
      covers: ["Application layer and HTTP", "Socket programming", "Reliable data transfer", "TCP and congestion control", "The network layer and routing", "Network security basics"],
      assessment: "Programming assignments 35%, midterm 25%, final exam 40%",
      lecturers: [{ name: "Prof Daniel Wong", background: null, emphasis: ["protocol design", "hands-on programming"] }],
      studentsSay: { workload: "Light, except in assignment weeks", difficulty: "Moderate", tips: ["Draw a timeline for every protocol question", "Test assignments against the lossy channel early"], pitfalls: ["Mixing up Go-Back-N and Selective Repeat on the midterm"] },
      fit: { buildsOn: ["CS2030S programming methodology", "CS2100 computer organisation"], gaps: ["Java socket programming"], relevance: "Needed for networking, security and distributed systems modules." },
      howToStudy: ["Trace each protocol by hand on a loss scenario", "Start each programming assignment the week it is released"],
    },
  },
  ST2334: {
    lecturers: ["Dr Chen Mei"],
    profile: {
      oneLine: "Probability and statistics for computing: probability rules, random variables, distributions, estimation and hypothesis testing.",
      covers: ["Probability and counting", "Conditional probability and Bayes' theorem", "Random variables", "Common distributions", "Estimation", "Hypothesis testing"],
      assessment: "Tutorial quizzes 20%, midterm 30%, final exam 50%",
      lecturers: [{ name: "Dr Chen Mei", background: null, emphasis: ["worked examples", "intuition before formulas"] }],
      studentsSay: { workload: "Steady: a short quiz every week", difficulty: "Moderate, harder after the midterm", tips: ["Do the tutorial before the quiz, not after", "Write out the sample space when stuck"], pitfalls: ["Confusing independent with mutually exclusive"] },
      fit: { buildsOn: ["MA1521 calculus", "CS1231S discrete structures"], gaps: ["Integration for continuous distributions"], relevance: "The base for machine learning, data science and AI modules." },
      howToStudy: ["Draw a tree for every conditional probability question", "Check each answer against a quick simulation or a sanity bound"],
    },
  },
};

export const DEMO_USER_PROFILE: UserProfile = {
  headline: "Second-year Computer Science student",
  background: ["Programming in Java and Python (CS1101S, CS2030S)", "Data structures and algorithms (CS2040S)", "Discrete maths and proofs (CS1231S)", "Calculus and linear algebra (MA1521, MA1522)"],
  strengths: ["Programming", "Data structures"],
  watchOuts: ["Proof-heavy work in CS3230", "Probability is new in ST2334"],
  thisSemester: "Four modules; CS3230 and the CS2103T team project are the heaviest.",
  guideVoice: "Assume solid programming and data structures. Explain proofs step by step, and use short code examples where they help.",
};

// Modules already taken, for "builds on" and the profile above.
export const DEMO_HISTORY: { code: string; name: string }[] = [
  { code: "CS1101S", name: "Programming Methodology" },
  { code: "CS1231S", name: "Discrete Structures" },
  { code: "CS2030S", name: "Programming Methodology II" },
  { code: "CS2040S", name: "Data Structures and Algorithms" },
  { code: "CS2100", name: "Computer Organisation" },
  { code: "MA1521", name: "Calculus for Computing" },
  { code: "MA1522", name: "Linear Algebra for Computing" },
];
