const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// public 폴더 안의 HTML, 이미지 파일을 사용자에게 보여줌
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. 방 입장 로직
    socket.on('join_room', (data) => {
        socket.join(data.room);
    });

    // 2. 표 데이터 동기화
    socket.on('update_input', (data) => {
        socket.to(data.room).emit('receive_input', data);
    });

    // 3. 지도 마커 이동 동기화
    socket.on('move_marker', (data) => {
        socket.to(data.room).emit('update_marker', data);
    });

    // 4. 시체 추가/삭제 및 초기화 동기화
    socket.on('add_corpse', (data) => socket.to(data.room).emit('receive_add_corpse', data));
    socket.on('remove_corpse', (data) => socket.to(data.room).emit('receive_remove_corpse', data));
    socket.on('reset_markers', (data) => socket.to(data.room).emit('receive_reset_markers'));
    socket.on('reset_all', (data) => socket.to(data.room).emit('receive_reset_all'));
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`서버가 실행되었습니다. 포트: ${PORT}`);
});
