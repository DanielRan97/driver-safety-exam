// Computes campaign statistics purely from stored attempt rows — nothing
// here is invented; every number is derived from the "accepted" (latest
// sent) attempt per required driver.

export function computeCampaignStatistics(acceptedAttempts, questions) {
  const n = acceptedAttempts.length;
  const scores = acceptedAttempts.map((a) => a.score);
  const passedCount = acceptedAttempts.filter((a) => a.passed).length;

  const questionMisses = questions.map(() => 0);
  const questionCorrect = questions.map(() => 0);

  acceptedAttempts.forEach((a) => {
    let answers;
    try {
      answers = JSON.parse(a.answers_json || '[]');
    } catch {
      answers = [];
    }
    answers.forEach((ans) => {
      if (typeof ans.questionIndex !== 'number' || !questions[ans.questionIndex]) return;
      if (ans.isCorrect) questionCorrect[ans.questionIndex]++;
      else questionMisses[ans.questionIndex]++;
    });
  });

  const sortedScores = [...scores].sort((x, y) => x - y);
  const median = n === 0 ? 0
    : n % 2 === 1
      ? sortedScores[(n - 1) / 2]
      : Math.round((sortedScores[n / 2 - 1] + sortedScores[n / 2]) / 2);

  const questionStats = questions.map((q, i) => ({
    index: i,
    text: q.q,
    missedCount: questionMisses[i],
    correctCount: questionCorrect[i],
    missedPercent: n === 0 ? 0 : Math.round((questionMisses[i] / n) * 1000) / 10,
  }));

  const mostMissed = [...questionStats].sort((a, b) => b.missedCount - a.missedCount).slice(0, 3);
  const mostCorrect = [...questionStats].sort((a, b) => b.correctCount - a.correctCount).slice(0, 3);

  const avgIncorrect = n === 0 ? 0
    : Math.round((acceptedAttempts.reduce((sum, a) => sum + (questions.length - a.correct_count), 0) / n) * 10) / 10;

  return {
    totalCompleted: n,
    averageScore: n === 0 ? 0 : Math.round((scores.reduce((s, v) => s + v, 0) / n) * 10) / 10,
    highestScore: n === 0 ? 0 : Math.max(...scores),
    lowestScore: n === 0 ? 0 : Math.min(...scores),
    medianScore: median,
    passedCount,
    failedCount: n - passedCount,
    passPercent: n === 0 ? 0 : Math.round((passedCount / n) * 1000) / 10,
    perfectScoreCount: scores.filter((s) => s === 100).length,
    averageIncorrectAnswers: avgIncorrect,
    mostMissedQuestions: mostMissed,
    mostCorrectlyAnsweredQuestions: mostCorrect,
    questionStats,
  };
}
