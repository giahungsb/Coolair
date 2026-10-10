/* Trắc nghiệm (quiz) – port module `quiz` của phpFox 3.0: tạo quiz nhiều câu hỏi, làm bài trắc nghiệm,
   chấm điểm tự động, bảng xếp hạng người làm bài. Mỗi người chỉ làm một quiz một lần. */
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');
const { rlStore } = require('./ratestore');
const { User, Quiz, QuizAttempt, Notification } = require('./models');
const { friendIds, visQ } = require('./vis');
const { filter: censorFilter } = require('./censor');

const PER = 20;
const talkLimit = rateLimit({ store: rlStore('pf_quiz.talkLimit'), windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít giây.' } });

module.exports = (router, { auth, wrap, fail, S, N, isAdmin }) => {
  const oid = (id) => (isValidObjectId(id) ? id : null);
  const bad = (res, msg = 'Không tìm thấy.') => fail(res, msg, null, 404);
  // Cổng xem quiz (dùng chung cho xem / làm bài / xem kết quả): private chỉ chủ, friends chỉ bạn bè
  const canSeeQuiz = async (q, me) => {
    const oid2 = String(q.owner._id || q.owner);
    if (oid2 === me) return true;
    if (q.visibility === 'private') return false;
    if (q.visibility === 'friends' && !(await friendIds(me)).some((x) => String(x) === oid2)) return false;
    return true;
  };
  const qView = (q, me) => ({ id: String(q._id), title: q.title, desc: q.desc || '', questionNum: (q.questions || []).length,
    takes: q.takes || 0, visibility: q.visibility, createdAt: q.createdAt, mine: String(q.owner._id || q.owner) === me,
    owner: q.owner && q.owner.name ? { id: String(q.owner._id || q.owner), name: q.owner.name, avatar: q.owner.avatar || '' } : null });

  router.get('/quizzes', auth, wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const view = ['all', 'mine', 'friends'].includes(S(req.query.view)) ? S(req.query.view) : 'all';
    let q;
    if (view === 'mine') q = { owner: req.uid };
    else { const ids = await friendIds(req.uid); q = view === 'friends' ? { owner: { $in: ids }, visibility: { $ne: 'private' } } : visQ(req.uid, ids); }
    const [total, rows] = await Promise.all([
      Quiz.countDocuments(q),
      Quiz.find(q).sort({ createdAt: -1 }).skip((page - 1) * PER).limit(PER).populate('owner', 'name avatar').lean(),
    ]);
    res.json({ total, page, per: PER, quizzes: rows.map((x) => qView(x, req.uid)) });
  }));

  router.post('/quizzes', auth, talkLimit, wrap(async (req, res) => {
    const b = req.body, title = S(b.title).trim();
    const visibility = ['public', 'friends', 'private'].includes(S(b.visibility)) ? S(b.visibility) : 'public';
    if (!title || title.length > 120) return fail(res, 'Tiêu đề cần 1–120 ký tự.');
    const raw = Array.isArray(b.questions) ? b.questions : [];
    if (raw.length < 1 || raw.length > 50) return fail(res, 'Quiz cần 1–50 câu hỏi.');
    const questions = [];
    for (const [i, rq] of raw.entries()) {
      const text = S(rq.text).trim();
      const options = (Array.isArray(rq.options) ? rq.options : []).map((o) => S(o).trim()).filter(Boolean);
      const answer = Math.floor(Number(rq.answer));
      if (!text || text.length > 300) return fail(res, `Câu ${i + 1}: nội dung cần 1–300 ký tự.`);
      if (options.length < 2 || options.length > 6) return fail(res, `Câu ${i + 1}: cần 2–6 đáp án.`);
      if (options.some((o) => o.length > 120)) return fail(res, `Câu ${i + 1}: mỗi đáp án tối đa 120 ký tự.`);
      if (!(answer >= 0 && answer < options.length)) return fail(res, `Câu ${i + 1}: chưa chọn đáp án đúng.`);
      questions.push({ text: await censorFilter(text), options: await Promise.all(options.map((o) => censorFilter(o))), answer });
    }
    if ((await Quiz.countDocuments({ owner: req.uid })) >= 100) return fail(res, 'Mỗi người tối đa 100 quiz.');
    const q = await Quiz.create({ owner: req.uid, title: await censorFilter(title),
      desc: await censorFilter(S(b.desc).trim().slice(0, 1000)), questions, visibility });
    res.status(201).json({ quiz: { id: String(q._id), title: q.title } });
  }));

  router.get('/quizzes/:id', auth, wrap(async (req, res) => {
    const q = oid(req.params.id) && await Quiz.findById(req.params.id).populate('owner', 'name avatar');
    if (!q) return bad(res, 'Không tìm thấy quiz.');
    const me = req.uid, mine = String(q.owner._id) === me;
    if (!mine && q.visibility === 'private') return bad(res, 'Không tìm thấy quiz.');
    if (!mine && q.visibility === 'friends' && !(await friendIds(me)).some((x) => String(x) === String(q.owner._id))) return bad(res, 'Không tìm thấy quiz.');
    const attempt = await QuizAttempt.findOne({ quiz: q._id, user: me }).select('score total choices').lean();
    // đáp án đúng chỉ hiện với chủ quiz hoặc người đã làm bài xong
    const showAnswer = mine || !!attempt;
    res.json({ quiz: { ...qView(q, me),
      questions: q.questions.map((x, i) => ({ i, text: x.text, options: x.options, answer: showAnswer ? x.answer : undefined,
        picked: attempt ? attempt.choices[i] : undefined })),
      myScore: attempt ? { score: attempt.score, total: attempt.total } : null } });
  }));

  router.post('/quizzes/:id/take', auth, talkLimit, wrap(async (req, res) => {
    const q = oid(req.params.id) && await Quiz.findById(req.params.id).select('owner visibility questions takes');
    if (!q) return bad(res, 'Không tìm thấy quiz.');
    if (!(await canSeeQuiz(q, req.uid))) return bad(res, 'Không tìm thấy quiz.');   // private/friends-only không làm được
    if (String(q.owner) === req.uid) return fail(res, 'Bạn là chủ quiz nên không cần làm bài.');
    if (await QuizAttempt.exists({ quiz: q._id, user: req.uid })) return fail(res, 'Bạn đã làm quiz này rồi.', null, 409);
    const raw = Array.isArray(req.body.choices) ? req.body.choices : [];
    if (raw.length !== q.questions.length) return fail(res, 'Bạn chưa trả lời đủ các câu hỏi.');
    const choices = raw.map((c) => Math.floor(Number(c)));
    if (choices.some((c, i) => !(c >= 0 && c < q.questions[i].options.length))) return fail(res, 'Đáp án không hợp lệ.');
    let score = 0; choices.forEach((c, i) => { if (c === q.questions[i].answer) score++; });
    try { await QuizAttempt.create({ quiz: q._id, user: req.uid, choices, score, total: q.questions.length }); }
    catch (e) { if (e.code === 11000) return fail(res, 'Bạn đã làm quiz này rồi.', null, 409); throw e; }
    await Quiz.updateOne({ _id: q._id }, { $inc: { takes: 1 } });
    await N.add('quiz_taken', String(q._id), q.owner, req.uid, score + '/' + q.questions.length);
    res.json({ score, total: q.questions.length });
  }));

  router.get('/quizzes/:id/results', auth, wrap(async (req, res) => {
    const q = oid(req.params.id) && await Quiz.findById(req.params.id).select('_id owner visibility questions');
    if (!q) return bad(res, 'Không tìm thấy quiz.');
    if (!(await canSeeQuiz(q, req.uid))) return bad(res, 'Không tìm thấy quiz.');   // không lộ kết quả quiz private
    const rows = await QuizAttempt.find({ quiz: q._id }).sort({ score: -1, createdAt: 1 }).limit(20).populate('user', 'name avatar').lean();
    res.json({ results: rows.filter((r) => r.user).map((r) => ({ user: { id: String(r.user._id), name: r.user.name, avatar: r.user.avatar || '' },
      score: r.score, total: r.total, createdAt: r.createdAt })) });
  }));

  router.delete('/quizzes/:id', auth, wrap(async (req, res) => {
    const q = oid(req.params.id) && await Quiz.findById(req.params.id).select('_id owner title');
    if (!q) return bad(res, 'Không tìm thấy quiz.');
    const me = await User.findById(req.uid).select('email siteAdmin');
    if (String(q.owner) !== req.uid && !(me && isAdmin(me))) return fail(res, 'Bạn không có quyền xóa quiz này.', null, 403);
    await Promise.all([QuizAttempt.deleteMany({ quiz: q._id }), Notification.deleteMany({ item: String(q._id) }), q.deleteOne()]);
    res.json({ ok: true });
  }));
};
